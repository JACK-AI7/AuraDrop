// AuraDrop Binary Frame Protocol — P2PFS/1 Engine
// Compact 38-Byte Binary Framing with 64-Bit Offsets & Zero Base64 Overhead

export const AURA_MAGIC = 0x41555241; // 'AURA'
export const PROTOCOL_VERSION = 1;

export enum BinaryFrameType {
  DATA_CHUNK = 1,
  FILE_FIN = 2,
  ACK = 3,
  TRANSFER_REQ = 4,
  TRANSFER_RESP = 5,
  PAUSE = 6,
  RESUME = 7,
  HEALTH_CHECK = 8,
  ERROR = 9,
}

export interface DecodedFrame {
  magic: number;
  version: number;
  frameType: BinaryFrameType;
  transferId: string;
  sequence: number;
  offset: bigint;
  payloadLength: number;
  payload: Uint8Array;
}

const HEADER_SIZE = 38;

/**
 * Encodes a binary frame with 38-byte compact header and raw payload
 */
export function encodeBinaryFrame(
  frameType: BinaryFrameType,
  transferId: string,
  sequence: number,
  offset: bigint,
  payload: Uint8Array
): ArrayBuffer {
  const totalLength = HEADER_SIZE + payload.byteLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // 1. Magic (4 bytes)
  view.setUint32(0, AURA_MAGIC, false); // Big-endian

  // 2. Version (1 byte)
  view.setUint8(4, PROTOCOL_VERSION);

  // 3. Frame Type (1 byte)
  view.setUint8(5, frameType);

  // 4. Transfer ID (16 bytes fixed ASCII / UUID)
  const tidBytes = new Uint8Array(buffer, 6, 16);
  const encoder = new TextEncoder();
  const encodedId = encoder.encode(transferId.padEnd(16, ' ').slice(0, 16));
  tidBytes.set(encodedId);

  // 5. Sequence (4 bytes uint32)
  view.setUint32(22, sequence, false);

  // 6. Offset (8 bytes uint64 BigInt)
  view.setBigUint64(26, offset, false);

  // 7. Payload Length (4 bytes uint32)
  view.setUint32(34, payload.byteLength, false);

  // 8. Payload (raw binary bytes)
  if (payload.byteLength > 0) {
    new Uint8Array(buffer, HEADER_SIZE).set(payload);
  }

  return buffer;
}

/**
 * Decodes a binary frame from an ArrayBuffer
 */
export function decodeBinaryFrame(input: ArrayBuffer | ArrayBufferView): DecodedFrame | null {
  if (!input) return null;
  const isView = 'buffer' in input && input.buffer instanceof ArrayBuffer;
  const buffer = isView ? input.buffer : (input as ArrayBuffer);
  const byteOffset = isView ? (input as ArrayBufferView).byteOffset : 0;
  const byteLength = isView ? (input as ArrayBufferView).byteLength : (input as ArrayBuffer).byteLength;

  if (byteLength < HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer, byteOffset, byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== AURA_MAGIC) {
    return null; // Invalid magic header
  }

  const version = view.getUint8(4);
  const frameType = view.getUint8(5) as BinaryFrameType;

  // Transfer ID (16 bytes)
  const tidBytes = new Uint8Array(buffer, byteOffset + 6, 16);
  const decoder = new TextDecoder();
  const transferId = decoder.decode(tidBytes).trim();

  const sequence = view.getUint32(22, false);
  const offset = view.getBigUint64(26, false);
  const payloadLength = view.getUint32(34, false);

  if (byteLength < HEADER_SIZE + payloadLength) {
    return null; // Incomplete payload
  }

  const payload = new Uint8Array(buffer, byteOffset + HEADER_SIZE, payloadLength);

  return {
    magic,
    version,
    frameType,
    transferId,
    sequence,
    offset,
    payloadLength,
    payload,
  };
}
