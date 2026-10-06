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
import { FileSender, FileReceiver, SpeedCalculator } from '@auradrop/transfer-engine';

async function runTestSuite() {
  console.log('====================================================');
  console.log('🚀 AURADROP AUTOMATED TEST SUITE (P2PFS/1 Engine)');
  console.log('====================================================\n');

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
  // TEST 1: Cryptography & Key Derivation
  // ----------------------------------------------------
  console.log('👉 [1] Cryptography & AEAD Engine:');
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
  assert(fingerprint.split(' ').length === 4, `Safety fingerprint generated: ${fingerprint}`);

  // ----------------------------------------------------
  // TEST 2: QR Pairing Payload & Signature Verification
  // ----------------------------------------------------
  console.log('\n👉 [2] QR Code Pairing Engine:');
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
  assert(qrString.startsWith('PAIR://v1/'), 'QR code has PAIR://v1/ format');

  const parsedQr = parseAndVerifyQrPairingPayload(qrString, aliceIdentity.publicKeyHex);
  assert(parsedQr.valid && parsedQr.payload?.deviceId === 'dev_alice_01', 'QR signature verification succeeds');

  // ----------------------------------------------------
  // TEST 3: Security & Path Traversal Sanitization
  // ----------------------------------------------------
  console.log('\n👉 [3] Security & Sanitization (Section 38):');
  assert(sanitizeFilename('../../../etc/passwd') === 'passwd', 'Path traversal relative slashes removed');
  assert(sanitizeFilename('..\\..\\windows\\system32\\cmd.exe') === 'cmd.exe', 'Windows backslash traversal removed');
  assert(sanitizeFilename('CON.txt').startsWith('file_'), 'Windows reserved device name CON neutralized');
  assert(sanitizeFilename('vacation/photo:name*?.jpg') === 'photo_name__.jpg', 'Illegal characters sanitized');

  // ----------------------------------------------------
  // TEST 4: Protocol Framing & Stream Decoder
  // ----------------------------------------------------
  console.log('\n👉 [4] P2PFS/1 Protocol Framing:');
  const sampleJson = { fileId: 'file_123', chunkIndex: 0, length: 1024 };
  const encodedFrame = encodeFrame(FrameType.CHUNK_DATA, sampleJson, 42n);

  let frameReceived: any = null;
  const decoder = new FrameDecoder();
  decoder.on('frame', (f) => {
    frameReceived = f;
  });

  // Stream in split chunks to verify buffering & reassembly
  const part1 = encodedFrame.subarray(0, 10);
  const part2 = encodedFrame.subarray(10);
  decoder.push(part1);
  assert(frameReceived === null, 'Decoder waits for complete frame header & payload');
  decoder.push(part2);
  assert(
    frameReceived !== null && frameReceived.header.sequenceNumber === 42n && frameReceived.json.fileId === 'file_123',
    'Frame correctly reassembled from streaming byte chunks'
  );

  // ----------------------------------------------------
  // TEST 5: Real End-to-End P2P Socket File Transfer
  // ----------------------------------------------------
  console.log('\n👉 [5] Real Direct TCP Socket P2P File Transfer (Alice -> Bob):');
  const tempDir = path.join(os.tmpdir(), `auradrop_test_${Date.now()}`);
  const senderDir = path.join(tempDir, 'sender');
  const receiverDir = path.join(tempDir, 'receiver');
  fs.mkdirSync(senderDir, { recursive: true });
  fs.mkdirSync(receiverDir, { recursive: true });

  // Generate a test file (e.g. 1 MB of verifiable binary data)
  const testFileName = 'research_dataset.bin';
  const testFilePath = path.join(senderDir, testFileName);
  const testFileSize = 1024 * 1024; // 1 MB
  const testData = Buffer.alloc(testFileSize);
  for (let i = 0; i < testFileSize; i++) {
    testData[i] = (i * 31 + 7) & 0xff;
  }
  fs.writeFileSync(testFilePath, testData);
  const originalChecksum = computeSha256(testData);

  // Create real TCP Server for Bob (Receiver)
  const testPort = 48399;
  let serverSocket: net.Socket | null = null;

  const server = net.createServer((sock) => {
    serverSocket = sock;
  });

  await new Promise<void>((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  // Connect Alice (Sender)
  const clientSocket = new net.Socket();
  await new Promise<void>((resolve) => clientSocket.connect(testPort, '127.0.0.1', resolve));

  assert(serverSocket !== null, 'Direct TCP socket pair connected');

  const senderTransport = new TcpTransport(clientSocket, 'LOCAL_NETWORK');
  const receiverTransport = new TcpTransport(serverSocket!, 'LOCAL_NETWORK');

  const transferSession: TransferSession = {
    transferId: 'xfer_001',
    sessionId: 'sess_001',
    direction: 'send',
    senderDeviceId: 'dev_alice',
    senderName: 'Alice',
    receiverDeviceId: 'dev_bob',
    receiverName: 'Bob',
    files: [
      {
        id: 'f_001',
        name: testFileName,
        size: testFileSize,
        mimeType: 'application/octet-stream',
        checksum: originalChecksum,
      },
    ],
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

  const receiverSession: TransferSession = {
    ...transferSession,
    direction: 'receive',
  };

  const receiver = new FileReceiver(
    receiverSession,
    receiverTransport,
    aliceSessionKey,
    baseIv,
    { downloadDirectory: receiverDir }
  );

  const sender = new FileSender(
    transferSession,
    senderTransport,
    aliceSessionKey,
    baseIv,
    [
      {
        id: 'f_001',
        name: testFileName,
        size: testFileSize,
        mimeType: 'application/octet-stream',
        checksum: originalChecksum,
        localFilePath: testFilePath,
      },
    ],
    64 * 1024 // 64 KB chunks for testing multiple iterations
  );

  let receiverCompleted = false;
  receiver.on('completed', () => {
    receiverCompleted = true;
  });

  let progressEventsCount = 0;
  sender.on('progress', () => {
    progressEventsCount++;
  });

  // Execute transfer
  await sender.start();

  // Wait briefly for receiver to finalize file verification & write
  await new Promise((res) => setTimeout(res, 500));

  assert(receiverCompleted, 'Receiver emitted completed event');
  assert(progressEventsCount > 0, `Sender progress events emitted (${progressEventsCount} updates)`);

  const receivedFilePath = path.join(receiverDir, testFileName);
  assert(fs.existsSync(receivedFilePath), 'Received file exists on receiver disk');

  const receivedBytes = fs.readFileSync(receivedFilePath);
  const receivedChecksum = computeSha256(receivedBytes);
  assert(receivedChecksum === originalChecksum, 'Full-file SHA-256 checksum matches 100% byte-for-byte');

  // Teardown
  await senderTransport.close();
  await receiverTransport.close();
  server.close();

  // Clean test temp files
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
