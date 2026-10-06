import { EventEmitter } from 'node:events';
import {
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  computeSharedSecret,
  deriveSessionKey,
  generateSafetyFingerprint,
  signData,
  verifySignature,
} from '@auradrop/crypto';
import {
  FrameType,
  TransferState,
  HandshakeInitPayload,
  HandshakeResponsePayload,
  NegotiationRequestPayload,
  NegotiationResponsePayload,
  FileStartPayload,
  FileEndPayload,
  PlatformType,
} from '@auradrop/types';
import { PROTOCOL_VERSION, HANDSHAKE_TIMEOUT_MS } from '@auradrop/config';
import { encodeFrame, DecodedFrame, FLAGS } from './index';

export interface HandshakeSessionOptions {
  localDeviceId: string;
  localDeviceName: string;
  localPlatform: PlatformType;
  identityPrivateKeyHex: string;
  identityPublicKeyHex: string;
  trustedPeerPublicKeys?: Set<string>;
}

/**
 * Protocol session state machine managing the 9-step P2PFS/1 handshake and transfer negotiation
 */
export class ProtocolSession extends EventEmitter {
  public state: TransferState = 'IDLE';
  public sessionId: string = '';
  public peerDeviceId: string = '';
  public peerDeviceName: string = '';
  public peerPlatform?: PlatformType;
  public peerIdentityPublicKeyHex: string = '';
  public peerEphemeralPublicKeyHex: string = '';
  public safetyFingerprint: string = '';
  public sessionKey?: Buffer;
  public baseIv?: Buffer;
  public sequenceNumber: bigint = 0n;

  private localEphemeralKeyPair = generateEphemeralKeyPair();
  private handshakeNonce: string = '';
  private handshakeTimer?: NodeJS.Timeout;

  constructor(public options: HandshakeSessionOptions) {
    super();
  }

  /**
   * Start handshake as Sender (Client)
   */
  startSenderHandshake(): Buffer {
    this.setState('CONNECTING');
    this.handshakeNonce = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const initPayload: HandshakeInitPayload = {
      protocolVersion: PROTOCOL_VERSION,
      deviceId: this.options.localDeviceId,
      deviceName: this.options.localDeviceName,
      platform: this.options.localPlatform,
      ephemeralPublicKey: this.localEphemeralKeyPair.publicKeyHex,
      identityPublicKey: this.options.identityPublicKeyHex,
      timestamp: Date.now(),
      nonce: this.handshakeNonce,
    };

    this.startHandshakeTimeout();
    this.setState('AUTHENTICATING');
    return encodeFrame(FrameType.HANDSHAKE_INIT, initPayload, this.nextSequence());
  }

  /**
   * Handle incoming handshake frame as Receiver (Server)
   */
  handleHandshakeInit(payload: HandshakeInitPayload): Buffer {
    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Incompatible protocol: ${payload.protocolVersion}`);
    }

    this.peerDeviceId = payload.deviceId;
    this.peerDeviceName = payload.deviceName;
    this.peerPlatform = payload.platform;
    this.peerEphemeralPublicKeyHex = payload.ephemeralPublicKey;
    this.peerIdentityPublicKeyHex = payload.identityPublicKey;

    // Receiver signs sender's nonce + receiver's ephemeral key
    const dataToSign = `${payload.nonce}|${this.localEphemeralKeyPair.publicKeyHex}`;
    const signature = signData(dataToSign, this.options.identityPrivateKeyHex);

    // Compute shared secret & derive session key
    const sharedSecret = computeSharedSecret(
      this.localEphemeralKeyPair.privateKeyHex,
      this.peerEphemeralPublicKeyHex
    );
    this.sessionKey = deriveSessionKey(sharedSecret);
    this.baseIv = Buffer.from(this.sessionKey.subarray(0, 12));
    this.safetyFingerprint = generateSafetyFingerprint(
      this.options.identityPublicKeyHex,
      this.peerIdentityPublicKeyHex
    );

    const respPayload: HandshakeResponsePayload = {
      protocolVersion: PROTOCOL_VERSION,
      deviceId: this.options.localDeviceId,
      deviceName: this.options.localDeviceName,
      platform: this.options.localPlatform,
      ephemeralPublicKey: this.localEphemeralKeyPair.publicKeyHex,
      identityPublicKey: this.options.identityPublicKeyHex,
      signature,
      timestamp: Date.now(),
    };

    this.setState('PREPARING');
    return encodeFrame(FrameType.HANDSHAKE_RESP, respPayload, this.nextSequence());
  }

  /**
   * Complete handshake on Sender side upon receiving HandshakeResponse
   */
  handleHandshakeResponse(payload: HandshakeResponsePayload): void {
    this.clearHandshakeTimeout();

    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Incompatible protocol: ${payload.protocolVersion}`);
    }

    this.peerDeviceId = payload.deviceId;
    this.peerDeviceName = payload.deviceName;
    this.peerPlatform = payload.platform;
    this.peerEphemeralPublicKeyHex = payload.ephemeralPublicKey;
    this.peerIdentityPublicKeyHex = payload.identityPublicKey;

    // Verify receiver's cryptographic signature
    const dataToVerify = `${this.handshakeNonce}|${payload.ephemeralPublicKey}`;
    const isValid = verifySignature(dataToVerify, payload.signature, payload.identityPublicKey);
    if (!isValid) {
      this.setState('FAILED');
      throw new Error('Receiver signature verification failed');
    }

    // Compute shared secret & session key
    const sharedSecret = computeSharedSecret(
      this.localEphemeralKeyPair.privateKeyHex,
      this.peerEphemeralPublicKeyHex
    );
    this.sessionKey = deriveSessionKey(sharedSecret);
    this.baseIv = Buffer.from(this.sessionKey.subarray(0, 12));
    this.safetyFingerprint = generateSafetyFingerprint(
      this.options.identityPublicKeyHex,
      this.peerIdentityPublicKeyHex
    );

    this.setState('PREPARING');
    this.emit('handshake_complete', {
      peerDeviceId: this.peerDeviceId,
      peerDeviceName: this.peerDeviceName,
      safetyFingerprint: this.safetyFingerprint,
    });
  }

  /**
   * Sender negotiates transfer: sends file manifest and awaits receiver approval
   */
  createNegotiationRequest(request: NegotiationRequestPayload): Buffer {
    this.setState('WAITING_FOR_APPROVAL');
    return encodeFrame(FrameType.NEGOTIATION_REQUEST, request, this.nextSequence());
  }

  /**
   * Receiver responds with approval (accept or decline)
   */
  createNegotiationResponse(response: NegotiationResponsePayload): Buffer {
    if (response.accepted) {
      this.setState('TRANSFERRING');
    } else {
      this.setState('CANCELLED');
    }
    return encodeFrame(FrameType.NEGOTIATION_RESPONSE, response, this.nextSequence());
  }

  nextSequence(): bigint {
    const seq = this.sequenceNumber;
    this.sequenceNumber += 1n;
    return seq;
  }

  private setState(newState: TransferState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit('state_change', { from: oldState, to: newState });
  }

  private startHandshakeTimeout(): void {
    this.handshakeTimer = setTimeout(() => {
      if (this.state === 'CONNECTING' || this.state === 'AUTHENTICATING') {
        this.setState('FAILED');
        this.emit('error', new Error('Handshake timed out'));
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private clearHandshakeTimeout(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
  }

  destroy(): void {
    this.clearHandshakeTimeout();
    this.removeAllListeners();
  }
}
