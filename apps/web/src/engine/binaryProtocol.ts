// AuraDrop Binary Frame Protocol — P2PFS/1 Engine
// Standard P2PFS/1 20-Byte Binary Framing with 64-Bit Offsets & Legacy AURA Decoding

export const P2PF_MAGIC = 0x50325046; // 'P2PF'
export const AURA_MAGIC = 0x41555241; // 'AURA'
export const PROTOCOL_VERSION = 1;

export enum BinaryFrameType {
  HANDSHAKE_INIT = 0x01,
  HANDSHAKE_RESP = 0x02,
  HEALTH_PING = 0x03,
  HEALTH_PONG = 0x04,
  TRANSFER_REQ = 0x10,
  TRANSFER_RESP = 0x11,
  FILE_START = 0x20,
  DATA_CHUNK = 0x21,
  FILE_FIN = 0x22,
  ACK = 0x23,
  PAUSE = 0x24,
  RESUME = 0x25,
  ERROR = 0x26,
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

const P2PF_HEADER_SIZE = 20;
const AURA_HEADER_SIZE = 38;

/**
 * Encodes a binary frame with standard P2PFS/1 20-byte header (compatible with Android & Desktop)
 */
export function encodeBinaryFrame(
  frameType: BinaryFrameType,
  transferId: string,
  sequence: number,
  offset: bigint,
  payload: Uint8Array
): ArrayBuffer {
  const totalLength = P2PF_HEADER_SIZE + payload.byteLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // 1. Magic (4 bytes): 'P2PF'
  view.setUint32(0, P2PF_MAGIC, false); // Big-endian

  // 2. Version (1 byte): 1
  view.setUint8(4, PROTOCOL_VERSION);

  // 3. Frame Type (1 byte)
  view.setUint8(5, frameType);

  // 4. Flags (2 bytes): 0x0000
  view.setUint16(6, 0, false);

  // 5. Payload Length (4 bytes uint32)
  view.setUint32(8, payload.byteLength, false);

  // 6. Sequence Number / Offset (8 bytes uint64 BigInt)
  view.setBigUint64(12, offset > 0n ? offset : BigInt(sequence), false);

  // 7. Payload
  if (payload.byteLength > 0) {
    new Uint8Array(buffer, P2PF_HEADER_SIZE).set(payload);
  }

  return buffer;
}

/**
 * Decodes a binary frame from an ArrayBuffer (supports both P2PF 20-byte and legacy AURA 38-byte)
 */
export function decodeBinaryFrame(input: ArrayBuffer | ArrayBufferView): DecodedFrame | null {
  if (!input) return null;
  const isView = 'buffer' in input && input.buffer instanceof ArrayBuffer;
  const buffer = isView ? input.buffer : (input as ArrayBuffer);
  const byteOffset = isView ? (input as ArrayBufferView).byteOffset : 0;
  const byteLength = isView ? (input as ArrayBufferView).byteLength : (input as ArrayBuffer).byteLength;

  if (byteLength < P2PF_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer, byteOffset, byteLength);
  const magic = view.getUint32(0, false);

  // Case 1: Standard P2PFS/1 (Android, Desktop, WebRTC)
  if (magic === P2PF_MAGIC) {
    const version = view.getUint8(4);
    const rawType = view.getUint8(5);
    const payloadLength = view.getUint32(8, false);
    const offset = view.getBigUint64(12, false);
    const sequence = Number(offset);

    if (byteLength < P2PF_HEADER_SIZE + payloadLength) {
      return null;
    }

    // Map frame type
    let frameType: BinaryFrameType = rawType as BinaryFrameType;
    if (rawType === 0x01) frameType = BinaryFrameType.HANDSHAKE_INIT;
    else if (rawType === 0x02) frameType = BinaryFrameType.HANDSHAKE_RESP;
    else if (rawType === 0x03) frameType = BinaryFrameType.HEALTH_PING;
    else if (rawType === 0x04) frameType = BinaryFrameType.HEALTH_PONG;
    else if (rawType === 0x10) frameType = BinaryFrameType.TRANSFER_REQ;
    else if (rawType === 0x11) frameType = BinaryFrameType.TRANSFER_RESP;
    else if (rawType === 0x20) frameType = BinaryFrameType.FILE_START;
    else if (rawType === 0x21) frameType = BinaryFrameType.DATA_CHUNK;
    else if (rawType === 0x22) frameType = BinaryFrameType.FILE_FIN;
    else if (rawType === 0x23) frameType = BinaryFrameType.ACK;
    else if (rawType === 0x24) frameType = BinaryFrameType.PAUSE;
    else if (rawType === 0x25) frameType = BinaryFrameType.RESUME;
    else if (rawType === 0x26) frameType = BinaryFrameType.ERROR;

    const payload = new Uint8Array(buffer, byteOffset + P2PF_HEADER_SIZE, payloadLength);

    return {
      magic,
      version,
      frameType,
      transferId: '',
      sequence,
      offset,
      payloadLength,
      payload,
    };
  }

  // Case 2: Legacy AURA 38-Byte Framing
  if (magic === AURA_MAGIC && byteLength >= AURA_HEADER_SIZE) {
    const version = view.getUint8(4);
    const rawType = view.getUint8(5);
    const tidBytes = new Uint8Array(buffer, byteOffset + 6, 16);
    const decoder = new TextDecoder();
    const transferId = decoder.decode(tidBytes).trim();
    const sequence = view.getUint32(22, false);
    const offset = view.getBigUint64(26, false);
    const payloadLength = view.getUint32(34, false);

    if (byteLength < AURA_HEADER_SIZE + payloadLength) {
      return null;
    }

    let frameType = BinaryFrameType.DATA_CHUNK;
    if (rawType === 1 || rawType === 0x21) frameType = BinaryFrameType.DATA_CHUNK;
    else if (rawType === 2 || rawType === 0x22) frameType = BinaryFrameType.FILE_FIN;
    else if (rawType === 3 || rawType === 0x23) frameType = BinaryFrameType.ACK;

    const payload = new Uint8Array(buffer, byteOffset + AURA_HEADER_SIZE, payloadLength);

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

  return null;
}
