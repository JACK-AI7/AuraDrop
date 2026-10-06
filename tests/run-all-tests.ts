import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import * as os from 'node:os';
import {
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  computeSharedSecret,
  deriveSessionKey,
  encryptChunk,
  decryptChunk,
  computeSha256,
  generateSafetyFingerprint,
  createQrPairingPayloadString,
  parseAndVerifyQrPairingPayload,
  sanitizeFilename,
} from '@auradrop/crypto';
import {
  encodeFrame,
  FrameDecoder,
  ProtocolSession,
  FLAGS,
} from '@auradrop/protocol';
import { FrameType, TransferSession, DeviceInfo } from '@auradrop/types';
import { TcpTransport, NetworkOptimizer } from '@auradrop/network';
import { DiscoveryEngine } from '@auradrop/discovery';
import {
  FileSender,
  FileReceiver,
  SpeedCalculator,
  CheckpointManager,
  AuraTransferError,
} from '@auradrop/transfer-engine';

async function runComprehensiveTestSuite() {
  console.log('================================================================');
  console.log('🚀 AURADROP COMPREHENSIVE PRODUCTION TEST SUITE (P2PFS/1 Engine)');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      throw new Error(`Test assertion failed: ${testName}`);
    }
  }

  // ----------------------------------------------------
  // SUITE 1: Cryptography, Key Derivation & Replay Protection
  // ----------------------------------------------------
  console.log('👉 [SUITE 1] Cryptography & AEAD Engine:');
  const aliceEphemeral = generateEphemeralKeyPair();
  const bobEphemeral = generateEphemeralKeyPair();
  const aliceIdentity = generateIdentityKeyPair();
  const bobIdentity = generateIdentityKeyPair();

  const aliceShared = computeSharedSecret(aliceEphemeral.privateKeyHex, bobEphemeral.publicKeyHex);
  const bobShared = computeSharedSecret(bobEphemeral.privateKeyHex, aliceEphemeral.publicKeyHex);
  assert(aliceShared.equals(bobShared), 'X25519 ECDH shared secrets match exactly');

  const aliceSessionKey = deriveSessionKey(aliceShared);
  const bobSessionKey = deriveSessionKey(bobShared);
  assert(aliceSessionKey.equals(bobSessionKey), 'HKDF-SHA256 derived 256-bit session keys match');

  const baseIv = Buffer.alloc(12, 0x42);
  const secretPlaintext = Buffer.from('Confidential peer-to-peer file payload stream');
  const chunkIndex = 5;
  const encrypted = encryptChunk(secretPlaintext, aliceSessionKey, chunkIndex, baseIv);
  const decrypted = decryptChunk(encrypted.ciphertext, encrypted.authTag, bobSessionKey, chunkIndex, baseIv);
  assert(decrypted.equals(secretPlaintext), 'AEAD AES-256-GCM chunk encrypt/decrypt roundtrip succeeds');

  let tamperedDecryptionFailed = false;
  try {
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] ^= 0xff;
    decryptChunk(tamperedCiphertext, encrypted.authTag, bobSessionKey, chunkIndex, baseIv);
  } catch {
    tamperedDecryptionFailed = true;
  }
  assert(tamperedDecryptionFailed, 'AEAD correctly rejects tampered ciphertext');

  const fingerprint = generateSafetyFingerprint(aliceIdentity.publicKeyHex, bobIdentity.publicKeyHex);
  assert(fingerprint.split(' ').length === 4, `Safety fingerprint (SAS) generated: ${fingerprint}`);

  // ----------------------------------------------------
  // SUITE 2: QR Pairing Payload & Expiration
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 2] QR Code Pairing Engine & Expiration:');
  const qrString = createQrPairingPayloadString(
    {
      deviceId: 'dev_alice_01',
      deviceName: "Alice's Phone",
      platform: 'android',
      addresses: ['192.168.1.100'],
      port: 48291,
    },
    aliceEphemeral.publicKeyHex,
    aliceIdentity.privateKeyHex
  );
  assert(qrString.startsWith('PAIR://v1/'), 'QR code has PAIR://v1/ prefix');

  const parsedQr = parseAndVerifyQrPairingPayload(qrString, aliceIdentity.publicKeyHex);
  assert(parsedQr.valid && parsedQr.payload?.deviceId === 'dev_alice_01', 'QR signature verification succeeds');

  // Verify expired QR code rejection
  const expiredPayloadString = 'PAIR://v1/' + Buffer.from(JSON.stringify({
    version: 'v1',
    deviceId: 'dev_expired',
    expiresAt: Date.now() - 10000, // expired 10s ago
  })).toString('base64url');
  const expiredCheck = parseAndVerifyQrPairingPayload(expiredPayloadString);
  assert(!expiredCheck.valid && expiredCheck.error?.includes('expired'), 'Expired QR code correctly rejected');

  // ----------------------------------------------------
  // SUITE 3: Security & Path Traversal Sanitization
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 3] Security & Sanitization (Section 38):');
  assert(sanitizeFilename('../../../etc/passwd') === 'passwd', 'Path traversal relative slashes removed');
  assert(sanitizeFilename('..\\..\\windows\\system32\\cmd.exe') === 'cmd.exe', 'Windows backslash traversal removed');
  assert(sanitizeFilename('CON.txt').startsWith('file_'), 'Windows reserved device name CON neutralized');
  assert(sanitizeFilename('NUL.png').startsWith('file_'), 'Windows reserved device name NUL neutralized');
  assert(sanitizeFilename('vacation/photo:name*?.jpg') === 'photo_name__.jpg', 'Illegal characters sanitized');
  assert(sanitizeFilename('\x00malicious\x1f.bin') === 'malicious.bin', 'Null bytes and control characters stripped');

  // ----------------------------------------------------
  // SUITE 4: Protocol Framing & Stream Decoder
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 4] P2PFS/1 Protocol Framing:');
  const sampleJson = { fileId: 'file_123', chunkIndex: 0, length: 1024 };
  const encodedFrame = encodeFrame(FrameType.CHUNK_DATA, sampleJson, 42n);

  let frameReceived: any = null;
  const decoder = new FrameDecoder();
  decoder.on('frame', (f) => {
    frameReceived = f;
  });

  const part1 = encodedFrame.subarray(0, 10);
  const part2 = encodedFrame.subarray(10);
  decoder.push(part1);
  assert(frameReceived === null, 'Decoder buffers partial frame');
  decoder.push(part2);
  assert(
    frameReceived !== null && frameReceived.header.sequenceNumber === 42n && frameReceived.json.fileId === 'file_123',
    'Frame reassembled from streaming byte chunks'
  );

  // ----------------------------------------------------
  // SUITE 5: 10 MB Streaming File Transfer with SHA-256 Validation
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 5] 10 MB Streaming P2P Transfer (Alice -> Bob):');
  const tempDir = path.join(os.tmpdir(), `auradrop_test_${Date.now()}`);
  const senderDir = path.join(tempDir, 'sender');
  const receiverDir = path.join(tempDir, 'receiver');
  fs.mkdirSync(senderDir, { recursive: true });
  fs.mkdirSync(receiverDir, { recursive: true });

  const testFileName = 'video_clip_10mb.mp4';
  const testFilePath = path.join(senderDir, testFileName);
  const testFileSize = 10 * 1024 * 1024; // 10 Megabytes
  const testFd = fs.openSync(testFilePath, 'w');
  const chunkPattern = Buffer.alloc(256 * 1024);
  for (let i = 0; i < chunkPattern.length; i++) {
    chunkPattern[i] = (i * 13 + 3) & 0xff;
  }
  let written = 0;
  while (written < testFileSize) {
    const toWrite = Math.min(chunkPattern.length, testFileSize - written);
    fs.writeSync(testFd, chunkPattern, 0, toWrite);
    written += toWrite;
  }
  fs.closeSync(testFd);

  const testFileBytes = fs.readFileSync(testFilePath);
  const originalChecksum = computeSha256(testFileBytes);

  const testPort = 48410;
  let serverSocket: net.Socket | null = null;
  const server = net.createServer((sock) => {
    serverSocket = sock;
  });
  await new Promise<void>((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  const clientSocket = new net.Socket();
  await new Promise<void>((resolve) => clientSocket.connect(testPort, '127.0.0.1', resolve));

  const senderTransport = new TcpTransport(clientSocket, 'LOCAL_NETWORK');
  const receiverTransport = new TcpTransport(serverSocket!, 'LOCAL_NETWORK');

  const session: TransferSession = {
    transferId: 'xfer_10mb',
    sessionId: 'sess_10mb',
    direction: 'send',
    senderDeviceId: 'dev_alice',
    senderName: 'Alice',
    receiverDeviceId: 'dev_bob',
    receiverName: 'Bob',
    files: [{ id: 'f_10m', name: testFileName, size: testFileSize, mimeType: 'video/mp4', checksum: originalChecksum }],
    totalFiles: 1,
    totalBytes: testFileSize,
    transferredBytes: 0,
    status: 'TRANSFERRING',
    currentFileIndex: 0,
    currentFileTransferredBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    transport: 'LOCAL_NETWORK',
    transportLabel: 'Using local network',
    isLocalNetwork: true,
    startedAt: Date.now(),
    resumable: true,
  };

  const receiver = new FileReceiver(
    { ...session, direction: 'receive' },
    receiverTransport,
    aliceSessionKey,
    baseIv,
    { downloadDirectory: receiverDir }
  );

  const sender = new FileSender(
    session,
    senderTransport,
    aliceSessionKey,
    baseIv,
    [{ id: 'f_10m', name: testFileName, size: testFileSize, mimeType: 'video/mp4', checksum: originalChecksum, localFilePath: testFilePath }],
    256 * 1024 // 256 KB streaming chunks
  );

  let receiverFinished = false;
  receiver.on('completed', () => {
    receiverFinished = true;
  });

  await sender.start();
  await new Promise((res) => setTimeout(res, 500));

  assert(receiverFinished, '10 MB streaming file transfer completed');
  const receivedPath = path.join(receiverDir, testFileName);
  assert(fs.existsSync(receivedPath), 'Received 10 MB file written to disk');
  const receivedBytes = fs.readFileSync(receivedPath);
  assert(computeSha256(receivedBytes) === originalChecksum, '10 MB file SHA-256 matches byte-for-byte');

  await senderTransport.close();
  await receiverTransport.close();
  server.close();

  // ----------------------------------------------------
  // SUITE 6: Duplicate Filename Auto-Renaming
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 6] Duplicate Filename Collision Handling:');
  const dupPort = 48411;
  let dupServerSock: net.Socket | null = null;
  const dupServer = net.createServer((sock) => { dupServerSock = sock; });
  await new Promise<void>((res) => dupServer.listen(dupPort, '127.0.0.1', res));

  const dupClientSock = new net.Socket();
  await new Promise<void>((res) => dupClientSock.connect(dupPort, '127.0.0.1', res));

  const dupSenderTransport = new TcpTransport(dupClientSock, 'LOCAL_NETWORK');
  const dupReceiverTransport = new TcpTransport(dupServerSock!, 'LOCAL_NETWORK');

  const dupSmallContent = Buffer.from('Duplicate file testing content');
  const dupSmallChecksum = computeSha256(dupSmallContent);
  const dupSmallPath = path.join(senderDir, 'vacation.jpg');
  fs.writeFileSync(dupSmallPath, dupSmallContent);

  // Pre-create existing file in receiverDir
  fs.writeFileSync(path.join(receiverDir, 'vacation.jpg'), Buffer.from('Original preexisting vacation photo'));

  const dupSession: TransferSession = {
    transferId: 'xfer_dup',
    sessionId: 'sess_dup',
    direction: 'send',
    senderDeviceId: 'dev_alice',
    senderName: 'Alice',
    receiverDeviceId: 'dev_bob',
    receiverName: 'Bob',
    files: [{ id: 'f_dup', name: 'vacation.jpg', size: dupSmallContent.length, mimeType: 'image/jpeg', checksum: dupSmallChecksum }],
    totalFiles: 1,
    totalBytes: dupSmallContent.length,
    transferredBytes: 0,
    status: 'TRANSFERRING',
    currentFileIndex: 0,
    currentFileTransferredBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    transport: 'LOCAL_NETWORK',
    transportLabel: 'Using local network',
    isLocalNetwork: true,
    startedAt: Date.now(),
    resumable: true,
  };

  const dupReceiver = new FileReceiver(
    { ...dupSession, direction: 'receive' },
    dupReceiverTransport,
    aliceSessionKey,
    baseIv,
    { downloadDirectory: receiverDir }
  );

  const dupSender = new FileSender(
    dupSession,
    dupSenderTransport,
    aliceSessionKey,
    baseIv,
    [{ id: 'f_dup', name: 'vacation.jpg', size: dupSmallContent.length, mimeType: 'image/jpeg', checksum: dupSmallChecksum, localFilePath: dupSmallPath }],
    64 * 1024
  );

  await dupSender.start();
  await new Promise((res) => setTimeout(res, 300));

  assert(fs.existsSync(path.join(receiverDir, 'vacation.jpg')), 'Original preexisting file was preserved');
  assert(fs.existsSync(path.join(receiverDir, 'vacation (1).jpg')), 'Duplicate was automatically renamed to vacation (1).jpg');

  await dupSenderTransport.close();
  await dupReceiverTransport.close();
  dupServer.close();

  // ----------------------------------------------------
  // SUITE 7: Checkpoint Manager & Resumable Transfers
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 7] Checkpoint Persistence & Resume Engine:');
  const checkpointManager = new CheckpointManager(receiverDir);
  checkpointManager.saveCheckpoint({
    transferId: 'xfer_resume_01',
    fileId: 'file_large',
    filename: 'dataset.bin',
    totalSize: 500000000,
    verifiedBytes: 250000000, // 50% verified
    lastChunkIndex: 953,
    checksum: 'sha256_dataset',
    updatedAt: Date.now(),
  });

  const loadedCheckpoint = checkpointManager.getCheckpoint('xfer_resume_01', 'file_large');
  assert(loadedCheckpoint !== null && loadedCheckpoint.verifiedBytes === 250000000, 'Checkpoint correctly saved and restored from disk');

  checkpointManager.clearCheckpoint('xfer_resume_01', 'file_large');
  assert(checkpointManager.getCheckpoint('xfer_resume_01', 'file_large') === null, 'Checkpoint successfully cleared after transfer finalization');

  // ----------------------------------------------------
  // SUITE 8: Error Taxonomy & Actionable Failures
  // ----------------------------------------------------
  console.log('\n👉 [SUITE 8] Error Taxonomy (Section 11):');
  const connErr = AuraTransferError.connectionLost('Bob Pixel');
  assert(connErr.details.code === 'CONNECTION_LOST' && connErr.details.canRetry, 'Connection lost error generates actionable retry suggestion');

  const storageErr = AuraTransferError.storageUnavailable(5000000000, 100000000);
  assert(storageErr.details.code === 'STORAGE_UNAVAILABLE' && !storageErr.details.canRetry, 'Storage full error gives clear explanation without false retry');

  // Cleanup
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED WITH 100% SUCCESS!`);
  console.log('================================================================\n');
}

runComprehensiveTestSuite().catch((err) => {
  console.error('Test suite failure:', err);
  process.exit(1);
});
