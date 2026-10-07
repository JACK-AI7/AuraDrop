// AuraDrop Production Transfer Engine (P2PFS/1 Specification & V12 Cross-Device Fix)
// Zero-Simulation Data Plane: WebRTC RTCDataChannel, Real Signaling Server Discovery,
// Incremental Chunk-by-Chunk SHA-256 (FIPS 180-4), Bounded Memory OPFS Disk Writing,
// Backpressure Flow Control, Two-Way ACK_COMPLETE Handshake, and Resumable Checkpoints.

import {
  encodeBinaryFrame,
  decodeBinaryFrame,
  BinaryFrameType,
} from './binaryProtocol';
import { TransferStorage, CheckpointRecord } from './transferStorage';
import { IdentityManager, DeviceIdentity } from './identity';
import { SignalingClient } from './signalingClient';
import { WebRtcTransport } from './webRtcTransport';
import { TransportManager } from './transportManager';
import { IncrementalSha256 } from './incrementalSha256';
import { ProgressiveDiskWriter } from './diskWriter';
import {
  PeerDevice,
  PickedFile,
  TransferProgress,
  TransferRecord,
  ConnectionState,
} from '../types';
import { TransportStatistics, ControlMessage } from './transport';

export interface TransferEngineEvent {
  type:
    | 'peer_discovered'
    | 'peer_lost'
    | 'request'
    | 'progress'
    | 'completed'
    | 'error'
    | 'state_change'
    | 'diagnostics';
  transferId: string;
  senderName: string;
  fileName: string;
  fileSize: number;
  transferredBytes?: number;
  verifiedBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  state?: ConnectionState;
  sha256?: string;
  blobUrl?: string;
  error?: string;
  transport?: string;
}

export type EngineEventListener = (event: TransferEngineEvent) => void;
export type PeersUpdateListener = (peers: PeerDevice[]) => void;

export class TransferEngine {
  private static instance: TransferEngine;

  public identity: DeviceIdentity;
  public localId: string;
  public localName: string;
  public platform: string;

  private storage = TransferStorage.getInstance();
  private signaling: SignalingClient;
  private transportManager: TransportManager;
  private webRtcTransport: WebRtcTransport;

  private peersMap = new Map<string, PeerDevice>();
  private peerListeners: PeersUpdateListener[] = [];
  private eventListeners: EngineEventListener[] = [];

  // Active Receiving State
  private activeIncomingTransfer: {
    transferId: string;
    senderId: string;
    senderName: string;
    fileName: string;
    fileSize: number;
    expectedSha256: string;
    receivedBytes: number;
    verifiedOffset: number;
    hasher: IncrementalSha256;
    diskWriter: ProgressiveDiskWriter;
    startTime: number;
    lastCalcTime: number;
    lastCalcBytes: number;
    smoothedSpeed: number;
    state: ConnectionState;
  } | null = null;

  // Active Sending State
  private activeOutgoingTransfer: {
    transferId: string;
    targetPeerId: string;
    targetPeerName: string;
    file: File;
    expectedSha256: string;
    hasher: IncrementalSha256;
    sentBytes: number;
    verifiedOffset: number;
    chunkSize: number;
    startTime: number;
    lastCalcTime: number;
    lastCalcBytes: number;
    smoothedSpeed: number;
    state: ConnectionState;
    isCancelled: boolean;
    isPaused: boolean;
  } | null = null;

  // Throttling for UI updates (10–20 updates/sec)
  private lastUiNotifyTime = 0;

  private constructor() {
    this.identity = IdentityManager.getInstance().getIdentity();
    this.localId = this.identity.deviceId;
    this.localName = this.identity.displayName;
    this.platform = this.identity.platform;

    this.signaling = SignalingClient.getInstance(this.identity);
    this.transportManager = TransportManager.getInstance(this.signaling);
    this.webRtcTransport = this.transportManager.getWebRtcTransport();

    this.setupSignalingEvents();
    this.setupTransportEvents();
    this.signaling.connect();
  }

  public static getInstance(): TransferEngine {
    if (!TransferEngine.instance) {
      TransferEngine.instance = new TransferEngine();
    }
    return TransferEngine.instance;
  }

  // ---------------------------------------------------------------------------
  // LISTENERS
  // ---------------------------------------------------------------------------
  public onPeersUpdated(listener: PeersUpdateListener): () => void {
    this.peerListeners.push(listener);
    listener(Array.from(this.peersMap.values()));
    return () => {
      this.peerListeners = this.peerListeners.filter((l) => l !== listener);
    };
  }

  public onEngineEvent(listener: EngineEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private notifyPeers(): void {
    const list = Array.from(this.peersMap.values());
    this.peerListeners.forEach((l) => l(list));
  }

  private notifyEvent(evt: TransferEngineEvent, forceImmediate = false): void {
    const now = performance.now();
    if (!forceImmediate && now - this.lastUiNotifyTime < 50) {
      return; // Throttle UI rendering to ~20 fps
    }
    this.lastUiNotifyTime = now;
    this.eventListeners.forEach((l) => l(evt));
  }

  // ---------------------------------------------------------------------------
  // SIGNALING & PEER DISCOVERY (Section 3 & 7)
  // ---------------------------------------------------------------------------
  private setupSignalingEvents(): void {
    this.signaling.setCallbacks({
      onPeerList: (peers) => {
        this.peersMap.clear();
        for (const p of peers) {
          if (p.deviceId !== this.localId) {
            this.peersMap.set(p.deviceId, p);
          }
        }
        this.notifyPeers();
      },

      onPeerOnline: (peer) => {
        if (peer.deviceId !== this.localId) {
          this.peersMap.set(peer.deviceId, peer);
          this.notifyPeers();
        }
      },

      onPeerOffline: (deviceId) => {
        if (this.peersMap.delete(deviceId)) {
          this.notifyPeers();
        }
      },

      onSignal: (senderId, signal) => {
        this.webRtcTransport.handleRemoteSignal(senderId, signal);
      },

      onTransferRequest: (msg) => {
        this.handleTransferRequestMessage(msg);
      },

      onTransferResponse: (msg) => {
        this.handleTransferResponseMessage(msg);
      },

      onTransferAck: (msg) => {
        this.handleTransferAckMessage(msg);
      },
    });
  }

  private setupTransportEvents(): void {
    this.webRtcTransport.onFrameReceived((frameBytes) => {
      const frame = decodeBinaryFrame(frameBytes.buffer);
      if (frame) {
        this.handleBinaryFrame(frame);
      }
    });

    this.webRtcTransport.onControlReceived((msg) => {
      if (msg.type === 'ACK_COMPLETE' && this.activeOutgoingTransfer) {
        this.finalizeOutgoingTransfer(msg.transferId || this.activeOutgoingTransfer.transferId);
      } else if (msg.type === 'PAUSE' && this.activeIncomingTransfer) {
        this.activeIncomingTransfer.state = 'PAUSED';
      } else if (msg.type === 'CANCEL') {
        this.cancelActiveTransfer();
      }
    });

    this.webRtcTransport.onStateChanged((state) => {
      if (this.activeOutgoingTransfer) {
        this.activeOutgoingTransfer.state = state;
        this.notifyEvent({
          type: 'state_change',
          transferId: this.activeOutgoingTransfer.transferId,
          senderName: this.localName,
          fileName: this.activeOutgoingTransfer.file.name,
          fileSize: this.activeOutgoingTransfer.file.size,
          state,
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // PEER CONNECTION INITIATION (Section 4 & 5)
  // ---------------------------------------------------------------------------
  public async connectToPeer(peer: PeerDevice): Promise<boolean> {
    const existing = this.peersMap.get(peer.deviceId);
    if (existing) {
      existing.connectionState = 'CONNECTING';
      this.notifyPeers();
    }

    const connected = await this.webRtcTransport.connect(peer);
    if (connected && existing) {
      existing.connectionState = 'READY_TO_TRANSFER';
      this.notifyPeers();
    }
    return connected;
  }

  // ---------------------------------------------------------------------------
  // RECEIVER PIPELINE (Section 11, 14, 15, 22)
  // ---------------------------------------------------------------------------
  private async handleTransferRequestMessage(msg: any): Promise<void> {
    const payload = msg.payload || msg;
    const safeName = this.storage.sanitizeFilename(payload.fileName);
    const checkpoint = this.storage.getCheckpoint(payload.transferId);
    const resumeOffset = checkpoint ? checkpoint.verifiedOffset : 0;

    const diskWriter = new ProgressiveDiskWriter(payload.transferId, safeName);
    await diskWriter.init();

    this.activeIncomingTransfer = {
      transferId: payload.transferId,
      senderId: msg.senderId || payload.senderId,
      senderName: payload.senderName || 'Remote Peer',
      fileName: safeName,
      fileSize: payload.fileSize,
      expectedSha256: payload.sha256,
      receivedBytes: resumeOffset,
      verifiedOffset: resumeOffset,
      hasher: new IncrementalSha256(),
      diskWriter,
      startTime: Date.now(),
      lastCalcTime: performance.now(),
      lastCalcBytes: resumeOffset,
      smoothedSpeed: 0,
      state: 'WAITING_FOR_ACCEPTANCE',
    };

    this.notifyEvent(
      {
        type: 'request',
        transferId: payload.transferId,
        senderName: this.activeIncomingTransfer.senderName,
        fileName: safeName,
        fileSize: payload.fileSize,
        state: 'WAITING_FOR_ACCEPTANCE',
        sha256: payload.sha256,
        transport: 'WebRTC Direct',
      },
      true
    );
  }

  private async handleBinaryFrame(frame: any): Promise<void> {
    const xfer = this.activeIncomingTransfer;
    if (!xfer || xfer.transferId !== frame.transferId) return;

    if (frame.frameType === BinaryFrameType.DATA_CHUNK) {
      xfer.state = 'TRANSFERRING';
      const chunkBytes: Uint8Array = frame.payload;

      // 1. Incremental streaming SHA-256 (no whole-file RAM loading)
      xfer.hasher.update(chunkBytes);

      // 2. Progressive bounded disk write
      await xfer.diskWriter.writeChunk(chunkBytes);

      xfer.receivedBytes += chunkBytes.byteLength;
      xfer.verifiedOffset = xfer.receivedBytes;

      // 3. Real Throughput Calculation with Exponential Smoothing
      const now = performance.now();
      const timeDeltaMs = now - xfer.lastCalcTime;
      if (timeDeltaMs >= 100) {
        const bytesDelta = xfer.receivedBytes - xfer.lastCalcBytes;
        const instantSpeed = (bytesDelta / timeDeltaMs) * 1000;
        xfer.smoothedSpeed =
          xfer.smoothedSpeed === 0 ? instantSpeed : xfer.smoothedSpeed * 0.7 + instantSpeed * 0.3;
        xfer.lastCalcTime = now;
        xfer.lastCalcBytes = xfer.receivedBytes;
      }

      const remainingBytes = Math.max(0, xfer.fileSize - xfer.receivedBytes);
      const etaSeconds = xfer.smoothedSpeed > 0 ? Math.ceil(remainingBytes / xfer.smoothedSpeed) : 0;

      // 4. Periodic Resume Checkpoint (every 5 MB)
      if (xfer.receivedBytes % (5 * 1024 * 1024) < chunkBytes.byteLength) {
        this.storage.saveCheckpoint({
          transferId: xfer.transferId,
          fileId: xfer.fileName,
          fileName: xfer.fileName,
          fileSize: xfer.fileSize,
          expectedSha256: xfer.expectedSha256,
          verifiedOffset: xfer.verifiedOffset,
          updatedAt: new Date().toISOString(),
        });
      }

      this.notifyEvent({
        type: 'progress',
        transferId: xfer.transferId,
        senderName: xfer.senderName,
        fileName: xfer.fileName,
        fileSize: xfer.fileSize,
        transferredBytes: xfer.receivedBytes,
        verifiedBytes: xfer.verifiedOffset,
        speedBytesPerSec: xfer.smoothedSpeed,
        etaSeconds,
        state: 'TRANSFERRING',
        transport: 'WebRTC Direct',
      });
    } else if (frame.frameType === BinaryFrameType.FILE_FIN) {
      await this.finalizeIncomingTransfer();
    }
  }

  private async finalizeIncomingTransfer(): Promise<void> {
    const xfer = this.activeIncomingTransfer;
    if (!xfer) return;

    xfer.state = 'VERIFYING';
    this.notifyEvent(
      {
        type: 'progress',
        transferId: xfer.transferId,
        senderName: xfer.senderName,
        fileName: xfer.fileName,
        fileSize: xfer.fileSize,
        transferredBytes: xfer.fileSize,
        verifiedBytes: xfer.fileSize,
        state: 'VERIFYING',
        transport: 'WebRTC Direct',
      },
      true
    );

    // 1. Finalize incremental streaming SHA-256
    const receiverSha256 = xfer.hasher.finalize();

    // 2. Exact Checksum Equality Verification (Section 22)
    if (xfer.expectedSha256 && receiverSha256 !== xfer.expectedSha256) {
      xfer.state = 'FAILED_INTEGRITY';
      await xfer.diskWriter.cleanup();
      this.notifyEvent(
        {
          type: 'error',
          transferId: xfer.transferId,
          senderName: xfer.senderName,
          fileName: xfer.fileName,
          fileSize: xfer.fileSize,
          error: `SHA-256 Mismatch! Expected: ${xfer.expectedSha256}, Computed: ${receiverSha256}`,
          state: 'FAILED_INTEGRITY',
        },
        true
      );
      this.activeIncomingTransfer = null;
      return;
    }

    // 3. Commit file to disk & create download handle
    xfer.state = 'DATABASE_COMMIT';
    const { blobUrl } = await xfer.diskWriter.finalize();

    // Trigger browser file download
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = xfer.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // 4. Send Verified ACK_COMPLETE to sender over DataChannel and Signaling
    this.webRtcTransport.sendControl({
      type: 'ACK_COMPLETE',
      transferId: xfer.transferId,
      senderId: this.localId,
      targetId: xfer.senderId,
      payload: { sha256: receiverSha256, verified: true },
    });
    this.signaling.sendTransferAck(xfer.senderId, {
      transferId: xfer.transferId,
      sha256: receiverSha256,
      verified: true,
    });

    // 5. Persist record to storage history
    this.storage.removeCheckpoint(xfer.transferId);
    const record: TransferRecord = {
      id: xfer.transferId,
      fileName: xfer.fileName,
      fileSize: xfer.fileSize,
      senderName: xfer.senderName,
      receiverName: this.localName,
      status: 'COMPLETED',
      sha256: receiverSha256,
      timestamp: new Date().toISOString(),
      speedBytesPerSec: xfer.smoothedSpeed,
      transport: 'WebRTC Direct P2P',
      verifiedOffset: xfer.fileSize,
      blobUrl,
    };
    this.storage.saveRecord(record);

    xfer.state = 'COMPLETED';
    this.notifyEvent(
      {
        type: 'completed',
        transferId: xfer.transferId,
        senderName: xfer.senderName,
        fileName: xfer.fileName,
        fileSize: xfer.fileSize,
        transferredBytes: xfer.fileSize,
        verifiedBytes: xfer.fileSize,
        speedBytesPerSec: xfer.smoothedSpeed,
        sha256: receiverSha256,
        blobUrl,
        state: 'COMPLETED',
        transport: 'WebRTC Direct',
      },
      true
    );

    this.activeIncomingTransfer = null;
  }

  // ---------------------------------------------------------------------------
  // SENDER PIPELINE (Section 11, 12, 13, 17, 18, 22)
  // ---------------------------------------------------------------------------
  public async startOutgoingTransfer(targetPeer: PeerDevice, file: File): Promise<string> {
    const transferId = `xfer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const safeName = this.storage.sanitizeFilename(file.name);

    // Compute expected SHA-256 incrementally across bounded slices (never loading whole file into RAM)
    const previewHasher = new IncrementalSha256();
    const hashSliceSize = 1024 * 1024; // 1 MB slice
    for (let offset = 0; offset < file.size; offset += hashSliceSize) {
      const sliceBlob = file.slice(offset, offset + hashSliceSize);
      const sliceBuffer = await sliceBlob.arrayBuffer();
      previewHasher.update(new Uint8Array(sliceBuffer));
    }
    const senderSha256 = previewHasher.finalize();

    // Check for existing resume checkpoint
    const checkpoint = this.storage.getCheckpoint(transferId);
    const resumeOffset = checkpoint ? checkpoint.verifiedOffset : 0;

    this.activeOutgoingTransfer = {
      transferId,
      targetPeerId: targetPeer.deviceId,
      targetPeerName: targetPeer.name,
      file,
      expectedSha256: senderSha256,
      hasher: new IncrementalSha256(),
      sentBytes: resumeOffset,
      verifiedOffset: resumeOffset,
      chunkSize: 256 * 1024, // 256 KB starting chunk size
      startTime: Date.now(),
      lastCalcTime: performance.now(),
      lastCalcBytes: resumeOffset,
      smoothedSpeed: 0,
      state: 'WAITING_FOR_ACCEPTANCE',
      isCancelled: false,
      isPaused: false,
    };

    // Dispatch Transfer Request to recipient via signaling server
    this.signaling.sendTransferRequest(targetPeer.deviceId, {
      transferId,
      senderId: this.localId,
      senderName: this.localName,
      fileName: safeName,
      fileSize: file.size,
      sha256: senderSha256,
      verifiedOffset: resumeOffset,
    });

    this.notifyEvent(
      {
        type: 'progress',
        transferId,
        senderName: this.localName,
        fileName: safeName,
        fileSize: file.size,
        transferredBytes: resumeOffset,
        verifiedBytes: resumeOffset,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        state: 'WAITING_FOR_ACCEPTANCE',
        transport: 'WebRTC Direct',
      },
      true
    );

    return transferId;
  }

  private handleTransferResponseMessage(msg: any): void {
    const payload = msg.payload || msg;
    const xfer = this.activeOutgoingTransfer;
    if (!xfer || xfer.transferId !== payload.transferId) return;

    if (payload.accepted) {
      const startOffset = payload.verifiedOffset || 0;
      this.executeOutgoingStream(startOffset);
    } else {
      this.notifyEvent(
        {
          type: 'error',
          transferId: xfer.transferId,
          senderName: this.localName,
          fileName: xfer.file.name,
          fileSize: xfer.file.size,
          error: 'Recipient declined the transfer.',
          state: 'CANCELLED',
        },
        true
      );
      this.activeOutgoingTransfer = null;
    }
  }

  private handleTransferAckMessage(msg: any): void {
    const payload = msg.payload || msg;
    if (this.activeOutgoingTransfer && this.activeOutgoingTransfer.transferId === payload.transferId) {
      this.finalizeOutgoingTransfer(payload.transferId);
    }
  }

  private async executeOutgoingStream(startOffset = 0): Promise<void> {
    const xfer = this.activeOutgoingTransfer;
    if (!xfer) return;

    xfer.state = 'TRANSFERRING';
    const file = xfer.file;
    const totalBytes = file.size;
    let offset = startOffset;
    let sequence = Math.floor(startOffset / xfer.chunkSize);

    // Make sure WebRTC is connected
    const targetPeer = this.peersMap.get(xfer.targetPeerId);
    if (targetPeer && targetPeer.connectionState !== 'READY_TO_TRANSFER') {
      await this.connectToPeer(targetPeer);
    }

    const sendLoop = async () => {
      if (xfer.isCancelled) return;
      if (xfer.isPaused) {
        xfer.state = 'PAUSED';
        this.storage.saveCheckpoint({
          transferId: xfer.transferId,
          fileId: xfer.file.name,
          fileName: xfer.file.name,
          fileSize: totalBytes,
          expectedSha256: xfer.expectedSha256,
          verifiedOffset: offset,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      if (offset >= totalBytes) {
        // Send Binary FIN Frame
        const finFrame = encodeBinaryFrame(
          BinaryFrameType.FILE_FIN,
          xfer.transferId,
          sequence,
          BigInt(totalBytes),
          new Uint8Array(0)
        );
        await this.webRtcTransport.sendFrame(finFrame);

        xfer.state = 'VERIFYING';
        this.notifyEvent(
          {
            type: 'progress',
            transferId: xfer.transferId,
            senderName: this.localName,
            fileName: file.name,
            fileSize: totalBytes,
            transferredBytes: totalBytes,
            verifiedBytes: totalBytes,
            state: 'VERIFYING',
            transport: 'WebRTC Direct',
          },
          true
        );
        // Sender waits for receiver's ACK_COMPLETE before marking COMPLETED (Section 22)
        return;
      }

      // Adaptive chunk sizing (256 KB up to 1 MB) based on measured speed
      if (xfer.smoothedSpeed > 40 * 1024 * 1024) {
        xfer.chunkSize = 1024 * 1024;
      } else if (xfer.smoothedSpeed > 20 * 1024 * 1024) {
        xfer.chunkSize = 512 * 1024;
      } else {
        xfer.chunkSize = 256 * 1024;
      }

      // Read chunk incrementally via file.slice (bounded RAM consumption)
      const chunkBlob = file.slice(offset, offset + xfer.chunkSize);
      const chunkBuffer = await chunkBlob.arrayBuffer();
      const chunkBytes = new Uint8Array(chunkBuffer);

      // Frame with binary header
      const frameBuffer = encodeBinaryFrame(
        BinaryFrameType.DATA_CHUNK,
        xfer.transferId,
        sequence,
        BigInt(offset),
        chunkBytes
      );

      // Send via WebRTC DataChannel (with automatic backpressure)
      try {
        await this.webRtcTransport.sendFrame(frameBuffer);
      } catch (e) {
        console.warn('Transport frame send error', e);
      }

      offset += chunkBytes.byteLength;
      sequence++;
      xfer.sentBytes = offset;
      xfer.verifiedOffset = offset;

      // Real Throughput Calculation with Exponential Smoothing
      const now = performance.now();
      const timeDeltaMs = now - xfer.lastCalcTime;
      if (timeDeltaMs >= 100) {
        const bytesDelta = xfer.sentBytes - xfer.lastCalcBytes;
        const instantSpeed = (bytesDelta / timeDeltaMs) * 1000;
        xfer.smoothedSpeed =
          xfer.smoothedSpeed === 0 ? instantSpeed : xfer.smoothedSpeed * 0.7 + instantSpeed * 0.3;
        xfer.lastCalcTime = now;
        xfer.lastCalcBytes = xfer.sentBytes;
      }

      const remainingBytes = Math.max(0, totalBytes - offset);
      const etaSeconds = xfer.smoothedSpeed > 0 ? Math.ceil(remainingBytes / xfer.smoothedSpeed) : 0;

      this.notifyEvent({
        type: 'progress',
        transferId: xfer.transferId,
        senderName: this.localName,
        fileName: file.name,
        fileSize: totalBytes,
        transferredBytes: offset,
        verifiedBytes: offset,
        speedBytesPerSec: xfer.smoothedSpeed,
        etaSeconds,
        state: 'TRANSFERRING',
        transport: 'WebRTC Direct',
      });

      // Cooperative yield
      setTimeout(sendLoop, 12);
    };

    sendLoop();
  }

  private finalizeOutgoingTransfer(transferId: string): void {
    const xfer = this.activeOutgoingTransfer;
    if (!xfer || xfer.transferId !== transferId) return;

    xfer.state = 'COMPLETED';
    this.storage.removeCheckpoint(xfer.transferId);

    const record: TransferRecord = {
      id: xfer.transferId,
      fileName: xfer.file.name,
      fileSize: xfer.file.size,
      senderName: this.localName,
      receiverName: xfer.targetPeerName,
      status: 'COMPLETED',
      sha256: xfer.expectedSha256,
      timestamp: new Date().toISOString(),
      speedBytesPerSec: xfer.smoothedSpeed,
      transport: 'WebRTC Direct P2P',
      verifiedOffset: xfer.file.size,
    };
    this.storage.saveRecord(record);

    this.notifyEvent(
      {
        type: 'completed',
        transferId: xfer.transferId,
        senderName: this.localName,
        fileName: xfer.file.name,
        fileSize: xfer.file.size,
        transferredBytes: xfer.file.size,
        verifiedBytes: xfer.file.size,
        speedBytesPerSec: xfer.smoothedSpeed,
        sha256: xfer.expectedSha256,
        state: 'COMPLETED',
        transport: 'WebRTC Direct',
      },
      true
    );

    this.activeOutgoingTransfer = null;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC CONTROLS: ACCEPT, DECLINE, PAUSE, RESUME, CANCEL
  // ---------------------------------------------------------------------------
  public acceptIncomingTransfer(): void {
    if (!this.activeIncomingTransfer) return;
    this.signaling.sendTransferResponse(this.activeIncomingTransfer.senderId, {
      transferId: this.activeIncomingTransfer.transferId,
      accepted: true,
      verifiedOffset: this.activeIncomingTransfer.verifiedOffset,
    });
  }

  public declineIncomingTransfer(): void {
    if (!this.activeIncomingTransfer) return;
    this.signaling.sendTransferResponse(this.activeIncomingTransfer.senderId, {
      transferId: this.activeIncomingTransfer.transferId,
      accepted: false,
    });
    this.activeIncomingTransfer = null;
  }

  public pauseActiveTransfer(): void {
    if (this.activeOutgoingTransfer) {
      this.activeOutgoingTransfer.isPaused = true;
      this.webRtcTransport.pause();
    }
  }

  public resumeActiveTransfer(): void {
    if (this.activeOutgoingTransfer && this.activeOutgoingTransfer.isPaused) {
      this.activeOutgoingTransfer.isPaused = false;
      this.webRtcTransport.resume();
      this.executeOutgoingStream(this.activeOutgoingTransfer.verifiedOffset);
    }
  }

  public cancelActiveTransfer(): void {
    if (this.activeOutgoingTransfer) {
      this.activeOutgoingTransfer.isCancelled = true;
      this.storage.removeCheckpoint(this.activeOutgoingTransfer.transferId);
      this.webRtcTransport.cancel();
      this.activeOutgoingTransfer = null;
    }
    if (this.activeIncomingTransfer) {
      this.activeIncomingTransfer.diskWriter.cleanup();
      this.storage.removeCheckpoint(this.activeIncomingTransfer.transferId);
      this.activeIncomingTransfer = null;
    }
  }

  public getDiagnostics(): TransportStatistics {
    return this.webRtcTransport.getStatistics();
  }
}
