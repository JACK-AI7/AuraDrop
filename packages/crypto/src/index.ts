import * as crypto from 'node:crypto';
import {
  CIPHER_ALGORITHM,
  HKDF_SALT_INFO,
  NONCE_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
  QR_PAIRING_PREFIX,
  QR_PAIRING_TOKEN_TTL_MS,
} from '@auradrop/config';
import { QrPairingPayload, PlatformType } from '@auradrop/types';

export interface KeyPair {
  publicKeyHex: string;
  privateKeyHex: string;
}

/**
 * Generate X25519 key pair for ECDH key exchange
 */
export function generateEphemeralKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKeyHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKeyHex: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
  };
}

/**
 * Generate long-term Ed25519 identity key pair
 */
export function generateIdentityKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKeyHex: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
  };
}

/**
 * Compute shared secret using ECDH X25519
 */
export function computeSharedSecret(localPrivateKeyHex: string, remotePublicKeyHex: string): Buffer {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(localPrivateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(remotePublicKeyHex, 'hex'),
    format: 'der',
    type: 'spki',
  });
  return crypto.diffieHellman({
    privateKey,
    publicKey,
  });
}

/**
 * Derive high-entropy 256-bit symmetric session key via HKDF-SHA256
 */
export function deriveSessionKey(
  sharedSecret: Buffer,
  saltHex?: string,
  infoString: string = HKDF_SALT_INFO
): Buffer {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : Buffer.alloc(32, 0);
  const derivedKey = crypto.hkdfSync('sha256', sharedSecret, salt, Buffer.from(infoString, 'utf8'), 32);
  return Buffer.from(derivedKey);
}

/**
 * Construct a deterministic 96-bit (12-byte) IV for chunk sequence replay protection.
 * First 4 bytes: random transfer IV salt. Last 8 bytes: big-endian chunk index.
 */
export function createChunkNonce(baseIv: Buffer, chunkIndex: number): Buffer {
  const nonce = Buffer.alloc(NONCE_LENGTH_BYTES);
  baseIv.copy(nonce, 0, 0, 4);
  nonce.writeBigUInt64BE(BigInt(chunkIndex), 4);
  return nonce;
}

export interface EncryptedChunkResult {
  ciphertext: Buffer;
  authTag: Buffer;
  nonce: Buffer;
}

/**
 * Encrypt a chunk using AES-256-GCM authenticated encryption (AEAD)
 */
export function encryptChunk(
  plaintext: Buffer,
  sessionKey: Buffer,
  chunkIndex: number,
  baseIv: Buffer
): EncryptedChunkResult {
  const nonce = createChunkNonce(baseIv, chunkIndex);
  const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, sessionKey, nonce, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  // Additional authenticated data (AAD) bound to chunk index
  const aad = Buffer.alloc(8);
  aad.writeBigUInt64BE(BigInt(chunkIndex));
  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, authTag, nonce };
}

/**
 * Decrypt a chunk using AES-256-GCM and verify authentication tag
 */
export function decryptChunk(
  ciphertext: Buffer,
  authTag: Buffer,
  sessionKey: Buffer,
  chunkIndex: number,
  baseIv: Buffer
): Buffer {
  const nonce = createChunkNonce(baseIv, chunkIndex);
  const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, sessionKey, nonce, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  const aad = Buffer.alloc(8);
  aad.writeBigUInt64BE(BigInt(chunkIndex));
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Compute SHA-256 hash of a buffer or stream
 */
export function computeSha256(data: Buffer | string): string {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Streaming SHA-256 hasher for multi-gigabyte files
 */
export class StreamingSha256 {
  private hash = crypto.createHash('sha256');

  update(chunk: Buffer): void {
    this.hash.update(chunk);
  }

  digest(): string {
    return this.hash.digest('hex');
  }
}

/**
 * Generate Safety Fingerprint / SAS (Short Authentication String)
 * 16-digit verification code formatted into 4 blocks of 4 digits: e.g. "8492 1029 4821 7730"
 * Derived deterministically from the sorted public keys.
 */
export function generateSafetyFingerprint(keyA: string, keyB: string): string {
  const sorted = [keyA, keyB].sort().join(':');
  const digest = crypto.createHash('sha256').update(sorted).digest();

  // Extract 4 32-bit integers modulo 10000
  const b1 = (digest.readUInt32BE(0) % 10000).toString().padStart(4, '0');
  const b2 = (digest.readUInt32BE(4) % 10000).toString().padStart(4, '0');
  const b3 = (digest.readUInt32BE(8) % 10000).toString().padStart(4, '0');
  const b4 = (digest.readUInt32BE(12) % 10000).toString().padStart(4, '0');

  return `${b1} ${b2} ${b3} ${b4}`;
}

/**
 * Sign data with Ed25519 private key
 */
export function signData(data: Buffer | string, privateKeyHex: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = crypto.sign(null, Buffer.from(data), privateKey);
  return signature.toString('hex');
}

/**
 * Verify Ed25519 signature
 */
export function verifySignature(data: Buffer | string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Generate QR pairing payload string: PAIR://v1/<base64url>
 */
export function createQrPairingPayloadString(
  deviceInfo: {
    deviceId: string;
    deviceName: string;
    platform: PlatformType;
    addresses: string[];
    port: number;
  },
  ephemeralPublicKeyHex: string,
  identityPrivateKeyHex: string
): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + QR_PAIRING_TOKEN_TTL_MS;

  const dataToSign = `${deviceInfo.deviceId}|${ephemeralPublicKeyHex}|${nonce}|${expiresAt}`;
  const tokenSignature = signData(dataToSign, identityPrivateKeyHex);

  const payload: QrPairingPayload = {
    version: 'v1',
    deviceId: deviceInfo.deviceId,
    deviceName: deviceInfo.deviceName,
    platform: deviceInfo.platform,
    ephemeralPublicKey: ephemeralPublicKeyHex,
    nonce,
    addresses: deviceInfo.addresses,
    port: deviceInfo.port,
    expiresAt,
    tokenSignature,
  };

  const jsonStr = JSON.stringify(payload);
  const base64Url = Buffer.from(jsonStr, 'utf8').toString('base64url');
  return `${QR_PAIRING_PREFIX}${base64Url}`;
}

/**
 * Parse and verify QR pairing payload
 */
export function parseAndVerifyQrPairingPayload(
  qrString: string,
  expectedSignerPublicKeyHex?: string
): { valid: boolean; payload?: QrPairingPayload; error?: string } {
  if (!qrString.startsWith(QR_PAIRING_PREFIX)) {
    return { valid: false, error: 'Invalid QR pairing URI format' };
  }

  const base64Url = qrString.slice(QR_PAIRING_PREFIX.length);
  try {
    const jsonStr = Buffer.from(base64Url, 'base64url').toString('utf8');
    const payload: QrPairingPayload = JSON.parse(jsonStr);

    if (payload.version !== 'v1') {
      return { valid: false, error: 'Unsupported QR pairing version' };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: 'QR pairing code has expired' };
    }

    if (expectedSignerPublicKeyHex) {
      const dataToSign = `${payload.deviceId}|${payload.ephemeralPublicKey}|${payload.nonce}|${payload.expiresAt}`;
      const isSigValid = verifySignature(dataToSign, payload.tokenSignature, expectedSignerPublicKeyHex);
      if (!isSigValid) {
        return { valid: false, error: 'Cryptographic signature mismatch' };
      }
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: `Malformed QR payload: ${err.message}` };
  }
}

/**
 * Section 38: Filename & Path Traversal Sanitizer
 * Prevents directory traversal attacks ('../', '..\\'), null bytes, absolute paths,
 * and dangerous OS reserved filenames.
 */
export function sanitizeFilename(rawFilename: string): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return 'unnamed_file';
  }

  // Remove null bytes and control characters
  let clean = rawFilename.replace(/[\x00-\x1F\x7F]/g, '');

  // Strip leading and trailing whitespace
  clean = clean.trim();

  // Replace backslashes with forward slashes for uniform processing
  clean = clean.replace(/\\/g, '/');

  // Take only the basename, completely stripping directory traversal paths
  const parts = clean.split('/').filter(Boolean);
  clean = parts.length > 0 ? parts[parts.length - 1] : 'unnamed_file';

  // Prevent parent directory references
  if (clean === '.' || clean === '..') {
    return 'safe_file';
  }

  // Filter illegal characters on Windows/Linux: < > : " / \ | ? *
  clean = clean.replace(/[<>:"/\\|?*]/g, '_');

  // Prevent Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const baseNameWithoutExt = clean.split('.')[0].toUpperCase();
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  if (reservedNames.includes(baseNameWithoutExt)) {
    clean = `file_${clean}`;
  }

  // Enforce reasonable length constraint
  if (clean.length > 255) {
    const ext = clean.lastIndexOf('.') > 0 ? clean.slice(clean.lastIndexOf('.')) : '';
    clean = clean.slice(0, 250 - ext.length) + ext;
  }

  return clean || 'unnamed_file';
}
