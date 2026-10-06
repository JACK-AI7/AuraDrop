import { EventEmitter } from 'node:events';
import { MAGIC_HEADER, PROTOCOL_VERSION_NUMBER, AUTH_TAG_LENGTH_BYTES } from '@auradrop/config';
import {
  FrameType,
  FrameHeader,
  HandshakeInitPayload,
  HandshakeResponsePayload,
  NegotiationRequestPayload,
  NegotiationResponsePayload,
  FileStartPayload,
  ChunkDataPayload,
  ChunkAckPayload,
  FileEndPayload,
} from '@auradrop/types';

export const HEADER_SIZE = 20; // 4 (magic) + 1 (version) + 1 (type) + 2 (flags) + 4 (len) + 8 (seq)

export const FLAGS = {
  NONE: 0x0000,
  JSON_PAYLOAD: 0x0001,
  ENCRYPTED: 0x0002,
  HAS_AEAD_TAG: 0x0008,
  IS_LAST_CHUNK: 0x0010,
} as const;

export interface DecodedFrame {
  header: FrameHeader;
  payload: Buffer;
  authTag?: Buffer;
  json?: any;
}

/**
 * Encode a protocol frame into binary buffer according to P2PFS/1 framing spec
 */
export function encodeFrame(
  frameType: FrameType,
  payload: Buffer | Record<string, any> | string,
  sequenceNumber: bigint = 0n,
  flags: number = FLAGS.NONE,
  authTag?: Buffer
): Buffer {
  let payloadBuffer: Buffer;
  let finalFlags = flags;

  if (Buffer.isBuffer(payload)) {
    payloadBuffer = payload;
  } else if (typeof payload === 'object') {
    finalFlags |= FLAGS.JSON_PAYLOAD;
    payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  } else {
    payloadBuffer = Buffer.from(payload, 'utf8');
  }

  if (authTag && authTag.length === AUTH_TAG_LENGTH_BYTES) {
    finalFlags |= FLAGS.HAS_AEAD_TAG;
  }

  const tagLen = authTag ? authTag.length : 0;
  const totalLength = HEADER_SIZE + payloadBuffer.length + tagLen;
  const buffer = Buffer.alloc(totalLength);

  // Magic 'P2PF'
  Buffer.from(MAGIC_HEADER).copy(buffer, 0, 0, 4);

  // Version 0x01
  buffer.writeUInt8(PROTOCOL_VERSION_NUMBER, 4);

  // Frame Type
  buffer.writeUInt8(frameType, 5);

  // Flags (uint16 BE)
  buffer.writeUInt16BE(finalFlags, 6);

  // Payload Length (uint32 BE)
  buffer.writeUInt32BE(payloadBuffer.length, 8);

  // Sequence Number (uint64 BE)
  buffer.writeBigUInt64BE(sequenceNumber, 12);

  // Payload
  payloadBuffer.copy(buffer, HEADER_SIZE);

  // Optional AEAD Tag
  if (authTag) {
    authTag.copy(buffer, HEADER_SIZE + payloadBuffer.length);
  }

  return buffer;
}

/**
 * Stream frame decoder that reassembles chunks, verifies magic bytes, and emits frames
 */
export class FrameDecoder extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);
  private maxFrameSize: number;

  constructor(maxFrameSize: number = 10 * 1024 * 1024) {
    super();
    this.maxFrameSize = maxFrameSize;
  }

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.length >= HEADER_SIZE) {
      // Find magic header
      if (
        this.buffer[0] !== MAGIC_HEADER[0] ||
        this.buffer[1] !== MAGIC_HEADER[1] ||
        this.buffer[2] !== MAGIC_HEADER[2] ||
        this.buffer[3] !== MAGIC_HEADER[3]
      ) {
        // Resynchronize: skip 1 byte and search for magic header
        const magicIndex = this.findMagicHeaderIndex(this.buffer);
        if (magicIndex === -1) {
          // Drop everything except last 3 bytes (which might start magic)
          this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
          return;
        }
        this.buffer = this.buffer.subarray(magicIndex);
        if (this.buffer.length < HEADER_SIZE) return;
      }

      // Read header
      const version = this.buffer.readUInt8(4);
      if (version !== PROTOCOL_VERSION_NUMBER) {
        this.emit('error', new Error(`Unsupported protocol version: ${version}`));
        this.buffer = this.buffer.subarray(4);
        continue;
      }

      const frameType = this.buffer.readUInt8(5) as FrameType;
      const flags = this.buffer.readUInt16BE(6);
      const payloadLength = this.buffer.readUInt32BE(8);
      const sequenceNumber = this.buffer.readBigUInt64BE(12);

      if (payloadLength > this.maxFrameSize) {
        this.emit('error', new Error(`Frame payload exceeds maximum size: ${payloadLength}`));
        this.buffer = this.buffer.subarray(4);
        continue;
      }

      const hasTag = (flags & FLAGS.HAS_AEAD_TAG) !== 0;
      const tagLength = hasTag ? AUTH_TAG_LENGTH_BYTES : 0;
      const totalFrameSize = HEADER_SIZE + payloadLength + tagLength;

      if (this.buffer.length < totalFrameSize) {
        // Awaiting remaining payload bytes
        return;
      }

      // Extract payload
      const payload = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + payloadLength);
      let authTag: Buffer | undefined;
      if (hasTag) {
        authTag = this.buffer.subarray(HEADER_SIZE + payloadLength, totalFrameSize);
      }

      const header: FrameHeader = {
        magic: MAGIC_HEADER,
        version,
        frameType,
        flags,
        payloadLength,
        sequenceNumber,
      };

      let json: any;
      if ((flags & FLAGS.JSON_PAYLOAD) !== 0) {
        try {
          json = JSON.parse(payload.toString('utf8'));
        } catch (err) {
          this.emit('error', new Error('Failed to parse frame JSON payload'));
        }
      }

      const frame: DecodedFrame = {
        header,
        payload,
        authTag,
        json,
      };

      // Advance buffer
      this.buffer = this.buffer.subarray(totalFrameSize);
      this.emit('frame', frame);
    }
  }

  private findMagicHeaderIndex(buf: Buffer): number {
    for (let i = 0; i <= buf.length - 4; i++) {
      if (
        buf[i] === MAGIC_HEADER[0] &&
        buf[i + 1] === MAGIC_HEADER[1] &&
        buf[i + 2] === MAGIC_HEADER[2] &&
        buf[i + 3] === MAGIC_HEADER[3]
      ) {
        return i;
      }
    }
    return -1;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export * from './session';
