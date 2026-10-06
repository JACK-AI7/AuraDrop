import { VisibilityMode } from '@auradrop/config';

export type { VisibilityMode };

export type PlatformType = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web';

/**
 * Section 33: Strongly Typed Application Transfer States
 */
export type TransferState =
  | 'IDLE'
  | 'DISCOVERING'
  | 'DEVICE_FOUND'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'WAITING_FOR_APPROVAL'
  | 'PREPARING'
  | 'TRANSFERRING'
  | 'PAUSED'
  | 'RECONNECTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Section 11: Network Transport Types & Priority
 */
export type TransportType =
  | 'DIRECT_WIFI_P2P'
  | 'LOCAL_NETWORK'
  | 'WEBRTC_DATA'
  | 'RELAY_FALLBACK';

export interface TransportDisplayInfo {
  type: TransportType;
  label: 'Connected directly' | 'Using local network' | 'Using relay' | 'Using WebRTC direct';
  isLocal: boolean;
  color: string;
}

/**
 * Nearby Device Identity
 */
export interface DeviceInfo {
  id: string;
  userId?: string;
  name: string;
  platform: PlatformType;
  publicKey: string; // Base64 or Hex public key
  addresses: string[]; // IPv4 / IPv6 addresses
  port: number;
  discoveryTransport: 'udp-multicast' | 'mdns' | 'lan-broadcast' | 'relay';
  lastSeen: number;
  visibilityMode: VisibilityMode;
  temporaryVisibilityExpiresAt?: number;
  pairingStatus: 'unpaired' | 'pairing' | 'paired' | 'trusted';
  signalStrength?: number; // 0 - 100 percentage
  avatar?: string;
  capabilities: {
    protocolVersion: string;
    supportsFolder: boolean;
    supportsResume: boolean;
    maxChunkSize: number;
  };
}

/**
 * File Metadata for Transfers
 */
export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  checksum: string; // SHA-256 hex string
  lastModified?: number;
  relativePath?: string; // For folder structure preservation
  previewThumbnail?: string; // Optional base64 thumbnail for images
}

/**
 * Full Transfer Session Status
 */
export interface TransferSession {
  transferId: string;
  sessionId: string;
  direction: 'send' | 'receive';
  senderDeviceId: string;
  senderName: string;
  receiverDeviceId: string;
  receiverName: string;
  files: FileMetadata[];
  totalFiles: number;
  totalBytes: number;
  transferredBytes: number;
  status: TransferState;
  currentFileIndex: number;
  currentFileTransferredBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  transport: TransportType;
  transportLabel: string;
  isLocalNetwork: boolean;
  error?: string;
  startedAt: number;
  completedAt?: number;
  resumable: boolean;
  sessionKeyFingerprint?: string; // 4-block verification code e.g. "8492 1029 4821 7730"
}

/**
 * Section 8: Universal Transfer Protocol Frame Types (P2PFS/1)
 */
export enum FrameType {
  // Handshake & Auth
  HANDSHAKE_INIT = 0x01,
  HANDSHAKE_RESP = 0x02,
  AUTH_CHALLENGE = 0x03,
  AUTH_VERIFY = 0x04,
  CAPABILITIES_EXCHANGE = 0x05,

  // Negotiation & Consent
  NEGOTIATION_REQUEST = 0x10,
  NEGOTIATION_RESPONSE = 0x11, // Accept or Decline

  // Data Stream
  FILE_START = 0x20,
  CHUNK_DATA = 0x21,
  CHUNK_ACK = 0x22,
  FILE_END = 0x23,
  TRANSFER_COMPLETE = 0x24,

  // Stream Control
  TRANSFER_PAUSE = 0x30,
  TRANSFER_RESUME = 0x31,
  TRANSFER_CANCEL = 0x32,
  TRANSFER_ERROR = 0x33,

  // Liveness
  PING = 0xF0,
  PONG = 0xF1,
}

export interface FrameHeader {
  magic: Uint8Array;     // 4 bytes: 'P2PF'
  version: number;       // 1 byte: 0x01
  frameType: FrameType;  // 1 byte
  flags: number;         // 2 bytes
  payloadLength: number; // 4 bytes uint32
  sequenceNumber: bigint;// 8 bytes uint64
}

/**
 * Handshake Init Payload
 */
export interface HandshakeInitPayload {
  protocolVersion: string; // 'P2PFS/1'
  deviceId: string;
  deviceName: string;
  platform: PlatformType;
  ephemeralPublicKey: string; // X25519 public key (hex or base64)
  identityPublicKey: string;  // Long-term Ed25519 public key
  timestamp: number;
  nonce: string;
}

/**
 * Handshake Response Payload
 */
export interface HandshakeResponsePayload {
  protocolVersion: string;
  deviceId: string;
  deviceName: string;
  platform: PlatformType;
  ephemeralPublicKey: string;
  identityPublicKey: string;
  signature: string; // Signature over (nonce + ephemeralPublicKey)
  timestamp: number;
}

/**
 * Negotiation Request (Sender -> Receiver)
 */
export interface NegotiationRequestPayload {
  transferId: string;
  totalFiles: number;
  totalBytes: number;
  files: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    checksum: string;
    relativePath?: string;
  }>;
  chunkSize: number;
}

/**
 * Negotiation Response (Receiver -> Sender)
 */
export interface NegotiationResponsePayload {
  transferId: string;
  accepted: boolean;
  reason?: 'user_declined' | 'storage_full' | 'unsupported_files' | 'busy' | 'security_policy';
  resumeOffsets?: Record<string, number>; // fileId -> bytes already written
}

/**
 * File Start Frame Payload
 */
export interface FileStartPayload {
  fileId: string;
  filename: string;
  size: number;
  mimeType: string;
  checksum: string;
  startOffset: number; // For resuming
}

/**
 * Chunk Frame Header Info
 */
export interface ChunkDataPayload {
  fileId: string;
  chunkIndex: number;
  offset: number;
  length: number;
  isLastChunk: boolean;
  chunkChecksum: string;
  authTag: string; // 16-byte hex tag for AEAD
  // Raw encrypted payload binary immediately follows in frame
}

/**
 * Chunk Ack
 */
export interface ChunkAckPayload {
  fileId: string;
  chunkIndex: number;
  offset: number;
  verifiedBytes: number;
}

/**
 * File End Payload
 */
export interface FileEndPayload {
  fileId: string;
  finalChecksum: string;
  totalBytesSent: number;
}

/**
 * Section 22: QR Pairing Payload Structure
 */
export interface QrPairingPayload {
  version: 'v1';
  deviceId: string;
  deviceName: string;
  platform: PlatformType;
  ephemeralPublicKey: string;
  nonce: string;
  addresses: string[];
  port: number;
  expiresAt: number;
  tokenSignature: string;
}

/**
 * Section 6: Database Models (PostgreSQL / Prisma / SQLite)
 */
export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceRecord {
  id: string;
  userId?: string | null;
  deviceName: string;
  platform: string;
  publicKey: string;
  lastSeen: Date;
  visibilityMode: VisibilityMode;
  createdAt: Date;
}

export interface PairingRecord {
  id: string;
  initiatorDeviceId: string;
  receiverDeviceId: string;
  pairingMethod: 'qr' | 'pin' | 'nfc' | 'trusted-contact';
  status: 'pending' | 'paired' | 'rejected' | 'revoked';
  createdAt: Date;
}

export interface TransferRecord {
  id: string;
  senderDeviceId: string;
  receiverDeviceId: string;
  totalFiles: number;
  totalBytes: bigint | number;
  transferredBytes: bigint | number;
  status: TransferState;
  startedAt: Date;
  completedAt?: Date | null;
  files?: TransferFileRecord[];
}

export interface TransferFileRecord {
  id: string;
  transferId: string;
  filename: string;
  size: bigint | number;
  mimeType: string;
  checksum: string;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';
}

/**
 * Section 24: Transfer History Query & Entry
 */
export type HistoryFilter = 'all' | 'sent' | 'received' | 'failed' | 'cancelled';

export interface HistoryItem {
  id: string;
  direction: 'sent' | 'received';
  counterpartName: string;
  counterpartDevice: string;
  counterpartPlatform: PlatformType;
  totalFiles: number;
  totalBytes: number;
  status: TransferState;
  timestamp: number;
  files: Array<{
    name: string;
    size: number;
    mimeType: string;
    localPath?: string;
  }>;
  transport: TransportType;
}
