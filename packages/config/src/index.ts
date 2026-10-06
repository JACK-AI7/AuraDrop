/**
 * AuraDrop Configuration & Protocol Constants
 * P2PFS/1 Specification Constants
 */

export const PROTOCOL_NAME = 'P2PFS';
export const PROTOCOL_VERSION = 'P2PFS/1';
export const PROTOCOL_VERSION_NUMBER = 1;

/** Magic 4-byte header identifying AuraDrop frames: ASCII 'P2PF' */
export const MAGIC_HEADER = new Uint8Array([0x50, 0x32, 0x50, 0x46]);

/** Default network ports */
export const DEFAULT_TRANSFER_PORT = 48291;
export const DEFAULT_DISCOVERY_UDP_PORT = 48290;
export const DEFAULT_MDNS_SERVICE_TYPE = '_auradrop._tcp';
export const DEFAULT_MULTICAST_GROUP = '239.255.48.29';

/** Streaming Chunk Sizes (Never load multi-gigabyte files into RAM) */
export const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256 KB per chunk
export const MIN_CHUNK_SIZE = 64 * 1024;      // 64 KB
export const MAX_CHUNK_SIZE = 1024 * 1024;    // 1 MB

/** Timing & Timeouts (milliseconds) */
export const HANDSHAKE_TIMEOUT_MS = 15000;
export const APPROVAL_TIMEOUT_MS = 60000;
export const INACTIVITY_TIMEOUT_MS = 30000;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const DISCOVERY_BROADCAST_INTERVAL_MS = 3000;
export const PEER_DISCOVERY_TTL_MS = 10000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_BACKOFF_BASE_MS = 1000;

/** Pairing */
export const QR_PAIRING_PREFIX = 'PAIR://v1/';
export const QR_PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Cryptography */
export const KEY_EXCHANGE_ALGORITHM = 'X25519';
export const CIPHER_ALGORITHM = 'aes-256-gcm'; // authenticated encryption AEAD
export const HASH_ALGORITHM = 'sha256';
export const HKDF_SALT_INFO = 'AuraDrop-P2PFS/1-Session-Key';
export const NONCE_LENGTH_BYTES = 12; // 96 bits for GCM
export const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits for GCM

/** Visibility Modes */
export type VisibilityMode = 'off' | 'contacts' | 'everyone';

export const TEMPORARY_VISIBILITY_PRESETS = [
  { label: '5 minutes', durationMs: 5 * 60 * 1000 },
  { label: '10 minutes', durationMs: 10 * 60 * 1000 },
  { label: '30 minutes', durationMs: 30 * 60 * 1000 },
] as const;

/** File MIME categories */
export const MIME_CATEGORIES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/heic', 'image/avif'],
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mkv'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/m4a'],
  pdf: ['application/pdf'],
  document: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'application/epub+zip',
  ],
  text: ['text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json', 'application/xml'],
  archive: ['application/zip', 'application/x-tar', 'application/gzip', 'application/x-7z-compressed', 'application/x-rar-compressed'],
};
