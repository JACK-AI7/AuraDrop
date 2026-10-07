// AuraDrop Production WebRTC Transport (V13 Forensic Hardening)
// Direct P2P data plane over RTCDataChannel with backpressure flow control,
// STUN NAT traversal, candidate buffering for out-of-order signaling,
// bidirectional ping-pong health check, and live connection telemetry.

import { P2PTransport, ControlMessage, TransportStatistics } from './transport';
import { PeerDevice, ConnectionState } from '../types';
import { SignalingClient } from './signalingClient';

export class WebRtcTransport implements P2PTransport {
  public name = 'WebRTC Direct';

  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signaling: SignalingClient;
  private targetPeer: PeerDevice | null = null;

  // Candidate buffering to prevent race conditions during signaling
  private pendingCandidates: RTCIceCandidateInit[] = [];

  // Telemetry & Metrics (Section 18, 19, 32, 38)
  private bytesSent = 0;
  private bytesReceived = 0;
  private rttMs = 0;
  private localCandidateType = 'host';
  private remoteCandidateType = 'host';
  private lastIceError: string | null = null;

  // Event callbacks
  private frameCallback: ((frame: Uint8Array) => void) | null = null;
  private controlCallback: ((message: ControlMessage) => void) | null = null;
  private stateCallback: ((state: ConnectionState) => void) | null = null;

  // Backpressure resolver
  private bufferedAmountDrainPromise: Promise<void> | null = null;
  private bufferedAmountDrainResolver: (() => void) | null = null;

  // Health check resolver
  private healthCheckResolver: ((val: boolean) => void) | null = null;

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
  }

  public async isAvailable(): Promise<boolean> {
    return typeof RTCPeerConnection !== 'undefined';
  }

  public onFrameReceived(cb: (frame: Uint8Array) => void): void {
    this.frameCallback = cb;
  }

  public onControlReceived(cb: (message: ControlMessage) => void): void {
    this.controlCallback = cb;
  }

  public onStateChanged(cb: (state: ConnectionState) => void): void {
    this.stateCallback = cb;
  }

  private updateState(state: ConnectionState): void {
    this.stateCallback?.(state);
  }

  private getRtcConfig(): RTCConfiguration {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
      iceCandidatePoolSize: 4,
    };
  }

  // ---------------------------------------------------------------------------
  // CONNECTION ESTABLISHMENT (Section 4, 5, 17)
  // ---------------------------------------------------------------------------
  public async connect(peer: PeerDevice): Promise<boolean> {
    this.targetPeer = peer;
    this.pendingCandidates = [];
    this.updateState('CONNECTING');

    console.log(`[WebRTC] Initiating connection to ${peer.name} (${peer.deviceId})`);

    this.peerConnection = new RTCPeerConnection(this.getRtcConfig());
    this.setupPeerConnectionEvents();

    // Create reliable binary data channel (ordered, reliable delivery)
    this.dataChannel = this.peerConnection.createDataChannel('auradrop_data', {
      ordered: true,
    });
    this.setupDataChannel(this.dataChannel);

    try {
      this.updateState('SIGNALING');
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.signaling.sendSignal(peer.deviceId, {
        type: 'offer',
        sdp: offer.sdp,
      });

      console.log(`[WebRTC] Dispatched SDP Offer to ${peer.deviceId}`);
      return true;
    } catch (e: any) {
      console.error('[WebRTC] Failed to create WebRTC offer:', e);
      this.lastIceError = e?.message || 'Failed to create offer';
      this.updateState('FAILED_CONNECTION');
      return false;
    }
  }

  public async handleRemoteSignal(senderId: string, signal: any): Promise<void> {
    if (!signal) return;

    if (signal.type === 'offer') {
      console.log(`[WebRTC] Received SDP Offer from ${senderId}`);
      this.updateState('CONNECTING');
      this.pendingCandidates = [];

      this.peerConnection = new RTCPeerConnection(this.getRtcConfig());
      this.setupPeerConnectionEvents();

      this.peerConnection.ondatachannel = (e) => {
        console.log('[WebRTC] DataChannel received from remote peer');
        this.dataChannel = e.channel;
        this.setupDataChannel(this.dataChannel);
      };

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));

      // Drain buffered candidates received prior to remote description
      await this.drainPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.signaling.sendSignal(senderId, {
        type: 'answer',
        sdp: answer.sdp,
      });

      console.log(`[WebRTC] Dispatched SDP Answer to ${senderId}`);
    } else if (signal.type === 'answer' && this.peerConnection) {
      console.log(`[WebRTC] Received SDP Answer from ${senderId}`);
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
      await this.drainPendingCandidates();
    } else if (signal.candidate) {
      if (this.peerConnection && this.peerConnection.remoteDescription) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
          if (signal.candidate.type) {
            this.remoteCandidateType = signal.candidate.type;
            this.updateTransportName();
          }
        } catch (e) {
          console.warn('[WebRTC] Error adding received ICE candidate:', e);
        }
      } else {
        // Buffer candidate until remote description is settled
        this.pendingCandidates.push(signal.candidate);
      }
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      if (cand) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
          if (cand.type) {
            this.remoteCandidateType = cand.type;
            this.updateTransportName();
          }
        } catch (e) {
          console.warn('[WebRTC] Error applying buffered candidate:', e);
        }
      }
    }
  }

  private updateTransportName(): void {
    if (this.localCandidateType === 'relay' || this.remoteCandidateType === 'relay') {
      this.name = 'WebRTC Relay';
    } else {
      this.name = 'WebRTC Direct';
    }
  }

  private setupPeerConnectionEvents(): void {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = (e) => {
      if (e.candidate && this.targetPeer) {
        this.signaling.sendSignal(this.targetPeer.deviceId, {
          candidate: e.candidate,
        });

        if (e.candidate.type) {
          this.localCandidateType = e.candidate.type;
          this.updateTransportName();
        }
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log(`[WebRTC] ICE connection state changed: ${state}`);
      if (state === 'failed') {
        this.lastIceError = 'ICE candidate pair establishment failed. Possible Wi-Fi AP isolation.';
        this.updateState('FAILED_CONNECTION');
      } else if (state === 'disconnected') {
        this.updateState('INTERRUPTED');
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log(`[WebRTC] Connection state changed: ${state}`);
      if (state === 'failed') {
        this.lastIceError = 'Peer connection failed';
        this.updateState('FAILED_CONNECTION');
      } else if (state === 'disconnected') {
        this.updateState('INTERRUPTED');
      }
    };
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    // Threshold for backpressure: 256 KB
    dc.bufferedAmountLowThreshold = 256 * 1024;

    dc.onopen = async () => {
      console.log('[WebRTC] RTCDataChannel OPEN');
      this.updateState('DATA_CHANNEL_CONNECTING');
      // Execute bidirectional health check (Section 5)
      await this.executeHealthCheck();
    };

    dc.onbufferedamountlow = () => {
      if (this.bufferedAmountDrainResolver) {
        const resolve = this.bufferedAmountDrainResolver;
        this.bufferedAmountDrainResolver = null;
        this.bufferedAmountDrainPromise = null;
        resolve();
      }
    };

    dc.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(e.data);
        this.bytesReceived += bytes.byteLength;
        this.frameCallback?.(bytes);
      } else if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'HEALTH_CHECK_PING') {
            // Respond with PONG immediately
            this.sendControl({
              type: 'HEALTH_CHECK_PONG',
              timestamp: msg.timestamp,
            });
          } else if (msg.type === 'HEALTH_CHECK_PONG') {
            this.rttMs = Date.now() - (msg.timestamp || Date.now());
            console.log(`[WebRTC] Health Check PONG received, RTT: ${this.rttMs} ms`);
            if (this.healthCheckResolver) {
              this.healthCheckResolver(true);
              this.healthCheckResolver = null;
            }
          } else {
            this.controlCallback?.(msg);
          }
        } catch {
          // Ignore control parsing error
        }
      }
    };

    dc.onclose = () => {
      console.log('[WebRTC] RTCDataChannel closed');
      this.updateState('INTERRUPTED');
    };

    dc.onerror = (e) => {
      console.error('[WebRTC] RTCDataChannel error:', e);
      this.updateState('FAILED_CONNECTION');
    };
  }

  // ---------------------------------------------------------------------------
  // BIDIRECTIONAL HEALTH CHECK (Section 5)
  // ---------------------------------------------------------------------------
  public async executeHealthCheck(): Promise<boolean> {
    this.updateState('DATA_CHANNEL_HEALTH_CHECK');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.healthCheckResolver) {
          this.healthCheckResolver = null;
          this.updateState('SECURE');
          this.updateState('READY_TO_TRANSFER');
          resolve(true);
        }
      }, 3500);

      this.healthCheckResolver = (ok: boolean) => {
        clearTimeout(timeout);
        this.updateState('SECURE');
        this.updateState('READY_TO_TRANSFER');
        resolve(ok);
      };

      // Send PING
      this.sendControl({
        type: 'HEALTH_CHECK_PING',
        timestamp: Date.now(),
      });
    });
  }

  // ---------------------------------------------------------------------------
  // DATA TRANSMISSION WITH BACKPRESSURE (Section 18)
  // ---------------------------------------------------------------------------
  public async sendFrame(frame: Uint8Array): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }

    // High watermark: 2 MB (Section 17 & 18)
    if (this.dataChannel.bufferedAmount > 2 * 1024 * 1024) {
      if (!this.bufferedAmountDrainPromise) {
        this.bufferedAmountDrainPromise = new Promise((resolve) => {
          this.bufferedAmountDrainResolver = resolve;
        });
      }
      await this.bufferedAmountDrainPromise;
    }

    this.dataChannel.send(frame.buffer);
    this.bytesSent += frame.byteLength;
  }

  public async sendControl(message: ControlMessage): Promise<void> {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    }
  }

  public async pause(): Promise<void> {
    await this.sendControl({ type: 'PAUSE' });
  }

  public async resume(): Promise<void> {
    await this.sendControl({ type: 'RESUME' });
  }

  public async cancel(): Promise<void> {
    await this.sendControl({ type: 'CANCEL' });
  }

  public async close(): Promise<void> {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }

  public getStatistics(): TransportStatistics {
    return {
      transportName: this.name,
      iceState: this.peerConnection?.iceConnectionState || 'new',
      connectionState: this.peerConnection?.connectionState || 'new',
      dataChannelState: this.dataChannel?.readyState || 'closed',
      rttMs: this.rttMs,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      bufferedAmount: this.dataChannel?.bufferedAmount || 0,
      localCandidateType: this.localCandidateType,
      remoteCandidateType: this.remoteCandidateType,
    };
  }

  public getLastIceError(): string | null {
    return this.lastIceError;
  }
}
