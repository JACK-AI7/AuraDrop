import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  decryptChunk,
  computeSha256,
  StreamingSha256,
  sanitizeFilename,
} from '@auradrop/crypto';
import { encodeFrame, DecodedFrame, FrameDecoder } from '@auradrop/protocol';
import { ITransport } from '@auradrop/network';
import {
  FrameType,
  TransferSession,
  FileStartPayload,
  ChunkDataPayload,
  ChunkAckPayload,
  FileEndPayload,
} from '@auradrop/types';
import { SpeedCalculator } from './speed-calculator';
import { CheckpointManager } from './checkpoint';

export interface FileReceiverOptions {
  downloadDirectory: string;
}

export class FileReceiver extends EventEmitter {
  private decoder = new FrameDecoder();
  private speedCalc = new SpeedCalculator();
  private checkpointManager: CheckpointManager;
  private currentFd?: number;
  private currentPartPath?: string;
  private currentFinalPath?: string;
  private currentFileId?: string;
  private currentExpectedChecksum?: string;
  private currentFileSize: number = 0;
  private currentBytesReceived: number = 0;
  private currentHasher = new StreamingSha256();
  private overallTransferred: number = 0;
  private isCancelled: boolean = false;
  private isPaused: boolean = false;

  constructor(
    private session: TransferSession,
    private transport: ITransport,
    private sessionKey: Buffer,
    private baseIv: Buffer,
    private options: FileReceiverOptions
  ) {
    super();
    this.checkpointManager = new CheckpointManager(options.downloadDirectory);

    try {
      if (!fs.existsSync(options.downloadDirectory)) {
        fs.mkdirSync(options.downloadDirectory, { recursive: true });
      }
    } catch {
      // Ignored
    }

    this.transport.on('data', (buf: Buffer) => {
      this.decoder.push(buf);
    });

    this.decoder.on('frame', (frame: DecodedFrame) => {
      this.handleFrame(frame);
    });
  }

  private async handleFrame(frame: DecodedFrame): Promise<void> {
    if (this.isCancelled) return;

    switch (frame.header.frameType) {
      case FrameType.FILE_START:
        await this.handleFileStart(frame.json as FileStartPayload);
        break;

      case FrameType.CHUNK_DATA:
        await this.handleChunkData(frame);
        break;

      case FrameType.FILE_END:
        await this.handleFileEnd(frame.json as FileEndPayload);
        break;

      case FrameType.TRANSFER_COMPLETE:
        this.session.status = 'COMPLETED';
        this.session.completedAt = Date.now();
        this.emit('completed', this.session);
        break;

      case FrameType.TRANSFER_CANCEL:
        this.cleanUpCurrentFile();
        this.session.status = 'CANCELLED';
        this.emit('cancelled');
        break;

      case FrameType.TRANSFER_PAUSE:
        this.isPaused = true;
        this.session.status = 'PAUSED';
        this.emit('paused');
        break;

      case FrameType.TRANSFER_RESUME:
        this.isPaused = false;
        this.session.status = 'TRANSFERRING';
        this.emit('resumed');
        break;
    }
  }

  private async handleFileStart(payload: FileStartPayload): Promise<void> {
    this.cleanUpCurrentFile();

    const safeName = sanitizeFilename(payload.filename);
    this.currentFileId = payload.fileId;
    this.currentExpectedChecksum = payload.checksum;
    this.currentFileSize = payload.size;
    this.currentBytesReceived = 0;
    this.currentHasher = new StreamingSha256();

    // Check for duplicate filenames and auto-rename: e.g. photo (1).jpg
    let finalPath = path.join(this.options.downloadDirectory, safeName);
    let counter = 1;
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);

    while (fs.existsSync(finalPath)) {
      finalPath = path.join(this.options.downloadDirectory, `${base} (${counter})${ext}`);
      counter++;
    }

    this.currentFinalPath = finalPath;
    this.currentPartPath = `${finalPath}.part`;

    this.currentFd = fs.openSync(this.currentPartPath, 'w');
    this.emit('file_started', { fileId: payload.fileId, filename: safeName, size: payload.size });
  }

  private async handleChunkData(frame: DecodedFrame): Promise<void> {
    if (!this.currentFd || !this.currentPartPath || !frame.authTag) return;

    // Unpack header JSON and ciphertext
    const headerLen = frame.payload.readUInt32BE(0);
    const headerJsonBuf = frame.payload.subarray(4, 4 + headerLen);
    const chunkInfo: ChunkDataPayload = JSON.parse(headerJsonBuf.toString('utf8'));
    const ciphertext = frame.payload.subarray(4 + headerLen);

    // Decrypt chunk with AEAD validation
    let plaintext: Buffer;
    try {
      plaintext = decryptChunk(
        ciphertext,
        frame.authTag,
        this.sessionKey,
        chunkInfo.chunkIndex,
        this.baseIv
      );
    } catch (err: any) {
      this.emit('error', new Error(`AEAD Decryption failed on chunk ${chunkInfo.chunkIndex}: ${err.message}`));
      return;
    }

    // Verify chunk hash
    const computedChunkHash = computeSha256(plaintext);
    if (computedChunkHash !== chunkInfo.chunkChecksum) {
      this.emit('error', new Error(`Chunk ${chunkInfo.chunkIndex} checksum mismatch`));
      return;
    }

    // Write chunk to file stream
    fs.writeSync(this.currentFd, plaintext, 0, plaintext.length, chunkInfo.offset);
    this.currentHasher.update(plaintext);

    this.currentBytesReceived += plaintext.length;
    this.overallTransferred += plaintext.length;

    // Update progress
    this.session.transferredBytes = this.overallTransferred;
    this.session.currentFileTransferredBytes = this.currentBytesReceived;

    const { speedBytesPerSec, etaSeconds } = this.speedCalc.update(
      this.overallTransferred,
      this.session.totalBytes
    );

    this.session.speedBytesPerSec = speedBytesPerSec;
    this.session.etaSeconds = etaSeconds;

    this.emit('progress', {
      fileId: chunkInfo.fileId,
      currentFileBytes: this.currentBytesReceived,
      totalFileBytes: this.currentFileSize,
      transferredBytes: this.overallTransferred,
      totalBytes: this.session.totalBytes,
      speedBytesPerSec,
      etaSeconds,
      percentage: Math.min(100, Math.floor((this.overallTransferred / this.session.totalBytes) * 100)),
    });

    // Send CHUNK_ACK
    const ackPayload: ChunkAckPayload = {
      fileId: chunkInfo.fileId,
      chunkIndex: chunkInfo.chunkIndex,
      offset: chunkInfo.offset,
      verifiedBytes: this.currentBytesReceived,
    };
    const ackFrame = encodeFrame(FrameType.CHUNK_ACK, ackPayload, BigInt(chunkInfo.chunkIndex));
    await this.transport.send(ackFrame);
  }

  private async handleFileEnd(payload: FileEndPayload): Promise<void> {
    if (this.currentFd) {
      fs.closeSync(this.currentFd);
      this.currentFd = undefined;
    }

    const calculatedChecksum = this.currentHasher.digest();

    if (calculatedChecksum !== this.currentExpectedChecksum) {
      // Checksum failure! Delete incomplete corrupted file
      if (this.currentPartPath && fs.existsSync(this.currentPartPath)) {
        fs.unlinkSync(this.currentPartPath);
      }
      this.emit('error', new Error(`Integrity check failed: checksum mismatch for ${payload.fileId}`));
      return;
    }

    // Atomically rename .part to final destination
    if (this.currentPartPath && this.currentFinalPath && fs.existsSync(this.currentPartPath)) {
      fs.renameSync(this.currentPartPath, this.currentFinalPath);
      this.emit('file_completed', {
        fileId: payload.fileId,
        savedPath: this.currentFinalPath,
        size: this.currentBytesReceived,
        checksum: calculatedChecksum,
      });
    }

    this.currentPartPath = undefined;
    this.currentFinalPath = undefined;
  }

  pause(): void {
    this.isPaused = true;
    this.session.status = 'PAUSED';
    const frame = encodeFrame(FrameType.TRANSFER_PAUSE, { transferId: this.session.transferId });
    this.transport.send(frame).catch(() => {});
  }

  resume(): void {
    this.isPaused = false;
    this.session.status = 'TRANSFERRING';
    const frame = encodeFrame(FrameType.TRANSFER_RESUME, { transferId: this.session.transferId });
    this.transport.send(frame).catch(() => {});
  }

  cancel(): void {
    this.isCancelled = true;
    this.cleanUpCurrentFile();
    this.session.status = 'CANCELLED';
    const frame = encodeFrame(FrameType.TRANSFER_CANCEL, { transferId: this.session.transferId });
    this.transport.send(frame).catch(() => {});
    this.emit('cancelled');
  }

  private cleanUpCurrentFile(): void {
    if (this.currentFd) {
      try {
        fs.closeSync(this.currentFd);
      } catch {
        // Ignored
      }
      this.currentFd = undefined;
    }
    if (this.currentPartPath && fs.existsSync(this.currentPartPath)) {
      try {
        fs.unlinkSync(this.currentPartPath);
      } catch {
        // Ignored
      }
    }
  }
}
