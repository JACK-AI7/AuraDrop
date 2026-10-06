import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  deriveSessionKey,
  computeSharedSecret,
  generateSafetyFingerprint,
  createQrPairingPayloadString,
} from '@auradrop/crypto';
import {
  encodeFrame,
  FrameDecoder,
  ProtocolSession,
  DecodedFrame,
} from '@auradrop/protocol';
import { DiscoveryEngine } from '@auradrop/discovery';
import { TcpTransport, NetworkOptimizer } from '@auradrop/network';
import {
  FileSender,
  FileReceiver,
  LocalFileToSend,
} from '@auradrop/transfer-engine';
import { LocalTransferHistoryStore } from '@auradrop/database';
import {
  DEFAULT_TRANSFER_PORT,
  DEFAULT_DISCOVERY_UDP_PORT,
} from '@auradrop/config';
import {
  DeviceInfo,
  TransferSession,
  TransferState,
  VisibilityMode,
  PlatformType,
  FrameType,
  HandshakeInitPayload,
  NegotiationRequestPayload,
} from '@auradrop/types';

export interface DesktopClientConfig {
  deviceName?: string;
  transferPort?: number;
  discoveryPort?: number;
  storageDir?: string;
}

export class DesktopClient extends EventEmitter {
  public deviceId: string;
  public deviceName: string;
  public platform: PlatformType;
  public identityKeys = generateIdentityKeyPair();
  public visibilityMode: VisibilityMode = 'everyone';
  public transferPort: number;

  private server?: net.Server;
  private discoveryEngine: DiscoveryEngine;
  private historyStore: LocalTransferHistoryStore;
  private storageDir: string;
  public activeTransfers = new Map<string, TransferSession>();
  public pendingApprovals = new Map<
    string,
    {
      session: TransferSession;
      transport: TcpTransport;
      protocolSession: ProtocolSession;
      files: any[];
    }
  >();

  constructor(config: DesktopClientConfig = {}) {
    super();
    this.deviceId = `auradrop_${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Math.random().toString(36).substring(2, 6)}`;
    this.deviceName = config.deviceName || `${os.hostname()} (Desktop)`;
    this.platform = os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'macos' : 'linux';
    this.transferPort = config.transferPort || DEFAULT_TRANSFER_PORT;

    this.storageDir = config.storageDir || path.join(os.homedir(), 'Downloads', 'AuraDrop');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.historyStore = new LocalTransferHistoryStore(path.join(os.homedir(), '.auradrop'));

    this.discoveryEngine = new DiscoveryEngine({
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      platform: this.platform,
      publicKeyHex: this.identityKeys.publicKeyHex,
      transferPort: this.transferPort,
      discoveryPort: config.discoveryPort || DEFAULT_DISCOVERY_UDP_PORT,
      visibilityMode: this.visibilityMode,
    });

    this.discoveryEngine.on('peer_discovered', (peer: DeviceInfo) => this.emit('peer_discovered', peer));
    this.discoveryEngine.on('peer_updated', (peer: DeviceInfo) => this.emit('peer_updated', peer));
    this.discoveryEngine.on('peer_disappeared', (peer: DeviceInfo) => this.emit('peer_disappeared', peer));
  }

  async start(): Promise<void> {
    await this.startTcpServer();

    try {
      await this.discoveryEngine.start();
    } catch (err) {
      console.warn('[DesktopClient] UDP discovery bind failed, continuing in fallback mode:', err);
    }

    this.emit('ready', {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      port: this.transferPort,
    });
  }

  private async startTcpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleInboundConnection(socket);
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          this.server?.listen(0, () => {
            const addr = this.server?.address() as net.AddressInfo;
            this.transferPort = addr.port;
            resolve();
          });
        } else {
          reject(err);
        }
      });

      this.server.listen(this.transferPort, () => {
        const addr = this.server?.address() as net.AddressInfo;
        this.transferPort = addr.port;
        resolve();
      });
    });
  }

  private handleInboundConnection(socket: net.Socket): void {
    const transport = new TcpTransport(socket, 'LOCAL_NETWORK');
    const decoder = new FrameDecoder();
    const protocolSession = new ProtocolSession({
      localDeviceId: this.deviceId,
      localDeviceName: this.deviceName,
      localPlatform: this.platform,
      identityPrivateKeyHex: this.identityKeys.privateKeyHex,
      identityPublicKeyHex: this.identityKeys.publicKeyHex,
    });

    transport.on('data', (buf: Buffer) => decoder.push(buf));

    decoder.on('frame', async (frame: DecodedFrame) => {
      try {
        if (frame.header.frameType === FrameType.HANDSHAKE_INIT) {
          const resp = protocolSession.handleHandshakeInit(frame.json as HandshakeInitPayload);
          await transport.send(resp);
        } else if (frame.header.frameType === FrameType.NEGOTIATION_REQUEST) {
          const req = frame.json as NegotiationRequestPayload;

          const session: TransferSession = {
            transferId: req.transferId,
            sessionId: `sess_${Date.now()}`,
            direction: 'receive',
            senderDeviceId: protocolSession.peerDeviceId,
            senderName: protocolSession.peerDeviceName,
            receiverDeviceId: this.deviceId,
            receiverName: this.deviceName,
            files: req.files,
            totalFiles: req.totalFiles,
            totalBytes: req.totalBytes,
            transferredBytes: 0,
            status: 'WAITING_FOR_APPROVAL',
            currentFileIndex: 0,
            currentFileTransferredBytes: 0,
            speedBytesPerSec: 0,
            etaSeconds: 0,
            transport: 'LOCAL_NETWORK',
            transportLabel: 'Using local network',
            isLocalNetwork: true,
            startedAt: Date.now(),
            resumable: true,
            sessionKeyFingerprint: protocolSession.safetyFingerprint,
          };

          this.activeTransfers.set(req.transferId, session);
          this.pendingApprovals.set(req.transferId, {
            session,
            transport,
            protocolSession,
            files: req.files,
          });

          this.emit('transfer_request', session);
        }
      } catch (err: any) {
        this.emit('error', err);
      }
    });
  }

  async acceptTransfer(transferId: string): Promise<void> {
    const pending = this.pendingApprovals.get(transferId);
    if (!pending) return;

    this.pendingApprovals.delete(transferId);
    const { session, transport, protocolSession } = pending;

    session.status = 'TRANSFERRING';
    const acceptFrame = protocolSession.createNegotiationResponse({
      transferId,
      accepted: true,
    });
    await transport.send(acceptFrame);

    const receiver = new FileReceiver(
      session,
      transport,
      protocolSession.sessionKey!,
      protocolSession.baseIv!,
      { downloadDirectory: this.storageDir }
    );

    receiver.on('progress', (prog: any) => {
      this.emit('transfer_progress', { transferId, ...prog });
    });

    receiver.on('completed', (sess: TransferSession) => {
      this.historyStore.addRecord({
        id: transferId,
        direction: 'received',
        counterpartName: sess.senderName,
        counterpartDevice: sess.senderDeviceId,
        counterpartPlatform: protocolSession.peerPlatform || 'android',
        totalFiles: sess.totalFiles,
        totalBytes: sess.totalBytes,
        status: 'COMPLETED',
        timestamp: Date.now(),
        files: sess.files.map((f: any) => ({ name: f.name, size: f.size, mimeType: f.mimeType })),
        transport: sess.transport,
      });
      this.emit('transfer_completed', sess);
    });

    receiver.on('error', (err: Error) => {
      this.emit('transfer_error', { transferId, error: err.message });
    });
  }

  async declineTransfer(transferId: string, reason: any = 'user_declined'): Promise<void> {
    const pending = this.pendingApprovals.get(transferId);
    if (!pending) return;

    this.pendingApprovals.delete(transferId);
    const { session, transport, protocolSession } = pending;

    session.status = 'CANCELLED';
    const declineFrame = protocolSession.createNegotiationResponse({
      transferId,
      accepted: false,
      reason,
    });
    await transport.send(declineFrame);
    await transport.close();

    this.emit('transfer_declined', { transferId });
  }

  async sendFilesToPeer(
    peer: DeviceInfo,
    localFiles: LocalFileToSend[]
  ): Promise<TransferSession> {
    const optimizer = new NetworkOptimizer();
    const { transport } = await optimizer.connectToPeer(peer);

    const protocolSession = new ProtocolSession({
      localDeviceId: this.deviceId,
      localDeviceName: this.deviceName,
      localPlatform: this.platform,
      identityPrivateKeyHex: this.identityKeys.privateKeyHex,
      identityPublicKeyHex: this.identityKeys.publicKeyHex,
    });

    const decoder = new FrameDecoder();
    transport.on('data', (buf: Buffer) => decoder.push(buf));

    const totalBytes = localFiles.reduce((acc, f) => acc + f.size, 0);
    const transferId = `xfer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const session: TransferSession = {
      transferId,
      sessionId: `sess_${Date.now()}`,
      direction: 'send',
      senderDeviceId: this.deviceId,
      senderName: this.deviceName,
      receiverDeviceId: peer.id,
      receiverName: peer.name,
      files: localFiles,
      totalFiles: localFiles.length,
      totalBytes,
      transferredBytes: 0,
      status: 'CONNECTING',
      currentFileIndex: 0,
      currentFileTransferredBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      transport: transport.getType(),
      transportLabel: transport.getDisplayInfo().label,
      isLocalNetwork: transport.getDisplayInfo().isLocal,
      startedAt: Date.now(),
      resumable: true,
    };

    this.activeTransfers.set(transferId, session);

    const handshakePromise = new Promise<void>((resolve, reject) => {
      decoder.once('frame', (frame: DecodedFrame) => {
        if (frame.header.frameType === FrameType.HANDSHAKE_RESP) {
          try {
            protocolSession.handleHandshakeResponse(frame.json);
            session.sessionKeyFingerprint = protocolSession.safetyFingerprint;
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      });
    });

    const initFrame = protocolSession.startSenderHandshake();
    await transport.send(initFrame);
    await handshakePromise;

    const negotiationPromise = new Promise<boolean>((resolve) => {
      decoder.once('frame', (frame: DecodedFrame) => {
        if (frame.header.frameType === FrameType.NEGOTIATION_RESPONSE) {
          const resp = frame.json;
          resolve(resp.accepted);
        }
      });
    });

    const negRequest = protocolSession.createNegotiationRequest({
      transferId,
      totalFiles: localFiles.length,
      totalBytes,
      files: localFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        checksum: f.checksum,
        relativePath: f.relativePath,
      })),
      chunkSize: 256 * 1024,
    });
    await transport.send(negRequest);

    session.status = 'WAITING_FOR_APPROVAL';
    this.emit('waiting_approval', session);

    const accepted = await negotiationPromise;
    if (!accepted) {
      session.status = 'CANCELLED';
      await transport.close();
      this.emit('transfer_declined', { transferId });
      throw new Error('Recipient declined the transfer request');
    }

    session.status = 'TRANSFERRING';
    const sender = new FileSender(
      session,
      transport,
      protocolSession.sessionKey!,
      protocolSession.baseIv!,
      localFiles
    );

    sender.on('progress', (prog: any) => {
      this.emit('transfer_progress', { transferId, ...prog });
    });

    sender.on('completed', (sess: TransferSession) => {
      this.historyStore.addRecord({
        id: transferId,
        direction: 'sent',
        counterpartName: peer.name,
        counterpartDevice: peer.id,
        counterpartPlatform: peer.platform,
        totalFiles: sess.totalFiles,
        totalBytes: sess.totalBytes,
        status: 'COMPLETED',
        timestamp: Date.now(),
        files: localFiles.map((f) => ({ name: f.name, size: f.size, mimeType: f.mimeType })),
        transport: sess.transport,
      });
      this.emit('transfer_completed', sess);
    });

    sender.start().catch((err: Error) => {
      this.emit('transfer_error', { transferId, error: err.message });
    });

    return session;
  }

  generateQrPairingCode(): string {
    const addresses = DiscoveryEngine.getLocalIpAddresses();
    return createQrPairingPayloadString(
      {
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        platform: this.platform,
        addresses,
        port: this.transferPort,
      },
      this.identityKeys.publicKeyHex,
      this.identityKeys.privateKeyHex
    );
  }

  getNearbyDevices(): DeviceInfo[] {
    return this.discoveryEngine.getDiscoveredDevices();
  }

  getHistory() {
    return this.historyStore.getHistory();
  }

  setVisibility(mode: VisibilityMode, temporaryDurationMs?: number): void {
    this.visibilityMode = mode;
    this.discoveryEngine.setVisibility(mode, temporaryDurationMs);
  }

  async stop(): Promise<void> {
    await this.discoveryEngine.stop();
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
  }
}
