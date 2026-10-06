import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { DEFAULT_CHUNK_SIZE } from '@auradrop/config';
import { encryptChunk, computeSha256 } from '@auradrop/crypto';
import { encodeFrame, DecodedFrame, FrameDecoder, FLAGS } from '@auradrop/protocol';
import { ITransport } from '@auradrop/network';
import {
  FrameType,
  FileMetadata,
  TransferSession,
  FileStartPayload,
  ChunkDataPayload,
  FileEndPayload,
} from '@auradrop/types';
import { SpeedCalculator } from './speed-calculator';

export interface LocalFileToSend extends FileMetadata {
  localFilePath: string;
}

export class FileSender extends EventEmitter {
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private speedCalc = new SpeedCalculator();
  private decoder = new FrameDecoder();

  constructor(
    private session: TransferSession,
    private transport: ITransport,
    private sessionKey: Buffer,
    private baseIv: Buffer,
    private files: LocalFileToSend[],
    private chunkSize: number = DEFAULT_CHUNK_SIZE
  ) {
    super();

    this.transport.on('data', (buf: Buffer) => {
      this.decoder.push(buf);
    });

    this.decoder.on('frame', (frame: DecodedFrame) => {
      this.handleReceiverFrame(frame);
    });
  }

  async start(): Promise<void> {
    this.speedCalc.reset();
    let overallTransferred = 0;

    for (let fileIdx = 0; fileIdx < this.files.length; fileIdx++) {
      if (this.isCancelled) break;

      const file = this.files[fileIdx];
      this.session.currentFileIndex = fileIdx;

      await this.sendFile(file, overallTransferred);
      overallTransferred += file.size;
    }

    if (!this.isCancelled) {
      // Send TRANSFER_COMPLETE
      const completeFrame = encodeFrame(
        FrameType.TRANSFER_COMPLETE,
        { transferId: this.session.transferId, completedAt: Date.now() },
        BigInt(this.files.length)
      );
      await this.transport.send(completeFrame);
      this.session.status = 'COMPLETED';
      this.emit('completed', this.session);
    }
  }

  private async sendFile(file: LocalFileToSend, overallOffsetBeforeFile: number): Promise<void> {
    // Send FILE_START
    const startPayload: FileStartPayload = {
      fileId: file.id,
      filename: file.name,
      size: file.size,
      mimeType: file.mimeType,
      checksum: file.checksum,
      startOffset: 0,
    };

    const startFrame = encodeFrame(FrameType.FILE_START, startPayload);
    await this.transport.send(startFrame);

    const fd = fs.openSync(file.localFilePath, 'r');
    const buffer = Buffer.alloc(this.chunkSize);
    let bytesReadFromFile = 0;
    let chunkIndex = 0;

    try {
      while (bytesReadFromFile < file.size) {
        if (this.isCancelled) break;

        // Pause loop
        while (this.isPaused && !this.isCancelled) {
          await new Promise((res) => setTimeout(res, 200));
        }

        const toRead = Math.min(this.chunkSize, file.size - bytesReadFromFile);
        const bytesRead = fs.readSync(fd, buffer, 0, toRead, bytesReadFromFile);
        if (bytesRead === 0) break;

        const chunkBuffer = buffer.subarray(0, bytesRead);
        const isLastChunk = bytesReadFromFile + bytesRead >= file.size;

        // Encrypt chunk with AEAD
        const { ciphertext, authTag } = encryptChunk(chunkBuffer, this.sessionKey, chunkIndex, this.baseIv);

        const chunkPayloadInfo: ChunkDataPayload = {
          fileId: file.id,
          chunkIndex,
          offset: bytesReadFromFile,
          length: bytesRead,
          isLastChunk,
          chunkChecksum: computeSha256(chunkBuffer),
          authTag: authTag.toString('hex'),
        };

        const flags = isLastChunk ? FLAGS.IS_LAST_CHUNK : FLAGS.NONE;
        // Frame carries JSON header info + raw encrypted ciphertext binary payload
        const headerJson = Buffer.from(JSON.stringify(chunkPayloadInfo), 'utf8');
        const headerLenBuf = Buffer.alloc(4);
        headerLenBuf.writeUInt32BE(headerJson.length, 0);

        const combinedPayload = Buffer.concat([headerLenBuf, headerJson, ciphertext]);

        const chunkFrame = encodeFrame(
          FrameType.CHUNK_DATA,
          combinedPayload,
          BigInt(chunkIndex),
          flags,
          authTag
        );

        await this.transport.send(chunkFrame);

        bytesReadFromFile += bytesRead;
        chunkIndex++;

        // Update session progress
        this.session.transferredBytes = overallOffsetBeforeFile + bytesReadFromFile;
        this.session.currentFileTransferredBytes = bytesReadFromFile;

        const { speedBytesPerSec, etaSeconds } = this.speedCalc.update(
          this.session.transferredBytes,
          this.session.totalBytes
        );

        this.session.speedBytesPerSec = speedBytesPerSec;
        this.session.etaSeconds = etaSeconds;

        this.emit('progress', {
          fileIndex: this.session.currentFileIndex,
          fileName: file.name,
          currentFileBytes: bytesReadFromFile,
          totalFileBytes: file.size,
          transferredBytes: this.session.transferredBytes,
          totalBytes: this.session.totalBytes,
          speedBytesPerSec,
          etaSeconds,
          percentage: Math.min(100, Math.floor((this.session.transferredBytes / this.session.totalBytes) * 100)),
        });
      }
    } finally {
      fs.closeSync(fd);
    }

    if (!this.isCancelled) {
      // Send FILE_END
      const endPayload: FileEndPayload = {
        fileId: file.id,
        finalChecksum: file.checksum,
        totalBytesSent: bytesReadFromFile,
      };
      const endFrame = encodeFrame(FrameType.FILE_END, endPayload);
      await this.transport.send(endFrame);
    }
  }

  pause(): void {
    this.isPaused = true;
    this.session.status = 'PAUSED';
    this.emit('paused');
  }

  resume(): void {
    this.isPaused = false;
    this.session.status = 'TRANSFERRING';
    this.emit('resumed');
  }

  cancel(): void {
    this.isCancelled = true;
    this.session.status = 'CANCELLED';
    const cancelFrame = encodeFrame(FrameType.TRANSFER_CANCEL, { transferId: this.session.transferId });
    this.transport.send(cancelFrame).catch(() => {});
    this.emit('cancelled');
  }

  private handleReceiverFrame(frame: DecodedFrame): void {
    if (frame.header.frameType === FrameType.TRANSFER_CANCEL) {
      this.isCancelled = true;
      this.session.status = 'CANCELLED';
      this.emit('remote_cancelled');
    } else if (frame.header.frameType === FrameType.TRANSFER_PAUSE) {
      this.isPaused = true;
      this.session.status = 'PAUSED';
      this.emit('remote_paused');
    } else if (frame.header.frameType === FrameType.TRANSFER_RESUME) {
      this.isPaused = false;
      this.session.status = 'TRANSFERRING';
      this.emit('remote_resumed');
    }
  }
}
