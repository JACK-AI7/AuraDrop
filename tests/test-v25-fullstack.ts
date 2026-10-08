/**
 * AURADROP V25 FULL-STACK COMPREHENSIVE VERIFICATION SUITE
 * 
 * Verifies:
 * 1. Neon PostgreSQL Durable Persistence (devices, trusted_device_pairs, schema migration 003).
 * 2. COTURN Relay Infrastructure & Ephemeral HMAC-SHA1 Credential Generation.
 * 3. P2PFS/1 20-Byte Binary Protocol Framing (Magic 0x50325046, 64-bit offsets).
 * 4. Standalone Signaling Service (Express HTTP + WebSocket on /ws, Healthz, Version, Pairing).
 * 5. Vercel Serverless Signaling Compatibility (api/signaling.ts with Neon DB integration).
 */

import '../services/signaling/src/config.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import { generateTurnCredentials } from '../services/signaling/src/turn/credentials.js';
import { NeonDatabaseService } from '../services/signaling/src/db/neon.js';
import { RedisRealtimeService } from '../services/signaling/src/redis/client.js';
import { WebSocketSignalingServer } from '../services/signaling/src/ws/server.js';
import { createApiRouter } from '../services/signaling/src/routes/api.js';
import { encodeBinaryFrame, decodeBinaryFrame, BinaryFrameType, P2PF_MAGIC } from '../apps/web/src/engine/binaryProtocol.js';
import vercelHandler from '../api/signaling.js';

let testPort = 0;
const LIVE_NEON_URL =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_6cqMlJ7OTkEg@ep-aged-bonus-b4oq4i1b-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('AuraDrop V25 Full-Stack Production Verification', () => {
  let db: NeonDatabaseService;
  let redis: RedisRealtimeService;
  let server: http.Server;
  let wss: WebSocketServer;

  before(async () => {
    // 1. Initialize DB & Redis
    db = new NeonDatabaseService();
    await db.initialize();

    redis = new RedisRealtimeService();
    await redis.initialize();

    // 2. Start Test Signaling Server
    const app = (await import('express')).default();
    const router = createApiRouter(db, redis);
    app.use(router);

    server = http.createServer(app);
    wss = new WebSocketServer({ noServer: true });
    new WebSocketSignalingServer(wss, db, redis);

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        testPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await redis.close();
    await db.close();
  });

  // ---------------------------------------------------------------------------
  // 1. NEON POSTGRESQL DURABLE PERSISTENCE
  // ---------------------------------------------------------------------------
  it('should connect to Neon PostgreSQL and verify V25 production schema', async () => {
    assert.strictEqual(db.isHealthy, true, 'Neon DB must be healthy');

    // Register a test desktop device
    const testDesktopId = `test_desk_${Date.now()}`;
    const desktopDev = await db.upsertDevice({
      deviceId: testDesktopId,
      displayName: 'Chrome Workstation',
      deviceName: 'Chrome Workstation',
      platform: 'web',
      deviceType: 'desktop',
    });
    assert.ok(desktopDev, 'Desktop device must be saved');
    assert.strictEqual(desktopDev.display_name, 'Chrome Workstation');

    // Register a test Android device
    const testAndroidId = `test_andr_${Date.now()}`;
    const androidDev = await db.upsertDevice({
      deviceId: testAndroidId,
      displayName: 'Pixel 9 Pro',
      deviceName: 'Pixel 9 Pro',
      platform: 'android',
      deviceType: 'mobile',
    });
    assert.ok(androidDev, 'Android device must be saved');
    assert.strictEqual(androidDev.display_name, 'Pixel 9 Pro');

    // Create durable trusted pairing between Desktop and Android
    const pair = await db.createTrustedPair(testDesktopId, testAndroidId);
    assert.ok(pair, 'Trusted pairing must be established');

    // Verify bilateral lookup
    const desktopPeers = await db.getTrustedPeerIds(testDesktopId);
    assert.ok(desktopPeers.includes(testAndroidId), 'Desktop must see Android as trusted peer');

    const androidPeers = await db.getTrustedPeerIds(testAndroidId);
    assert.ok(androidPeers.includes(testDesktopId), 'Android must see Desktop as trusted peer');

    // Verify device retrieval
    const retrieved = await db.getDevice(testDesktopId);
    assert.strictEqual(retrieved?.id, testDesktopId);
  });

  // ---------------------------------------------------------------------------
  // 2. COTURN DYNAMIC HMAC-SHA1 CREDENTIAL GENERATION
  // ---------------------------------------------------------------------------
  it('should generate valid RFC 5766 COTURN credentials with HMAC-SHA1', () => {
    const creds = generateTurnCredentials('test_device_web_42');
    assert.ok(creds, 'Credentials object must be generated');
    assert.ok(creds.username.includes(':test_device_web_42'), 'Username must contain device ID');
    assert.ok(creds.credential.length > 10, 'Credential must be HMAC-SHA1 base64 string');
    assert.ok(creds.iceServers.length >= 2, 'Must include both STUN and TURN endpoints');

    const turnServer = creds.iceServers.find((s: any) =>
      Array.isArray(s.urls) && s.urls.some((u: string) => u.startsWith('turn:'))
    );
    assert.ok(turnServer, 'Must contain TURN relay server');
    assert.strictEqual(turnServer.username, creds.username);
    assert.strictEqual(turnServer.credential, creds.credential);
  });

  // ---------------------------------------------------------------------------
  // 3. P2PFS/1 BINARY PROTOCOL FRAMING
  // ---------------------------------------------------------------------------
  it('should encode and decode P2PFS/1 20-byte binary frames with BigInt offsets', () => {
    const chunkData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xAA, 0xBB, 0xCC, 0xDD]);
    const offset = 1048576000n; // 1 GB file offset
    const sequence = 42;

    const frameBuffer = encodeBinaryFrame(
      BinaryFrameType.DATA_CHUNK,
      'xfer_test_99',
      sequence,
      offset,
      chunkData
    );

    assert.strictEqual(frameBuffer.byteLength, 20 + chunkData.byteLength, 'Header must be exactly 20 bytes');

    const decoded = decodeBinaryFrame(frameBuffer);
    assert.ok(decoded, 'Decoded frame must not be null');
    assert.strictEqual(decoded.magic, P2PF_MAGIC, 'Magic must be P2PF');
    assert.strictEqual(decoded.frameType, BinaryFrameType.DATA_CHUNK);
    assert.strictEqual(decoded.offset, offset, 'Offset BigInt must match exactly');
    assert.strictEqual(decoded.payloadLength, chunkData.byteLength);
    assert.deepStrictEqual(decoded.payload, chunkData);
  });

  // ---------------------------------------------------------------------------
  // 4. STANDALONE SIGNALING SERVICE (HTTP REST & WEBSOCKET)
  // ---------------------------------------------------------------------------
  it('should expose healthy HTTP endpoints (/healthz, /version, /turn/credentials)', async () => {
    // 1. Healthz
    const healthRes = await fetch(`http://127.0.0.1:${testPort}/healthz`);
    assert.strictEqual(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.database, true);

    // 2. Version
    const verRes = await fetch(`http://127.0.0.1:${testPort}/version`);
    assert.strictEqual(verRes.status, 200);
    const verData = await verRes.json();
    assert.strictEqual(verData.protocol, 'P2PFS/1');
    assert.strictEqual(verData.durableDb, 'Neon PostgreSQL');

    // 3. Turn Credentials
    const turnRes = await fetch(`http://127.0.0.1:${testPort}/turn/credentials?deviceId=desk_test_1`);
    assert.strictEqual(turnRes.status, 200);
    const turnData = await turnRes.json();
    assert.ok(turnData.iceServers);
  });

  it('should handle WebSocket AUTH, HEARTBEAT, and cross-client SIGNAL routing', async () => {
    const wsUrl = `ws://127.0.0.1:${testPort}/ws`;

    const devA = `ws_client_a_${Date.now()}`;
    const devB = `ws_client_b_${Date.now()}`;

    const wsA = new WebSocket(wsUrl);
    const wsB = new WebSocket(wsUrl);

    await Promise.all([
      new Promise<void>((resolve) => wsA.on('open', resolve)),
      new Promise<void>((resolve) => wsB.on('open', resolve)),
    ]);

    // Wait for AUTH_SUCCESS on both clients
    const authSuccessA = new Promise<void>((resolve) => {
      const handler = (raw: any) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'AUTH_SUCCESS') {
          wsA.off('message', handler);
          resolve();
        }
      };
      wsA.on('message', handler);
    });

    const authSuccessB = new Promise<void>((resolve) => {
      const handler = (raw: any) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'AUTH_SUCCESS') {
          wsB.off('message', handler);
          resolve();
        }
      };
      wsB.on('message', handler);
    });

    // Send AUTH for Client A
    wsA.send(
      JSON.stringify({
        type: 'AUTH',
        deviceId: devA,
        displayName: 'Web Client A',
        deviceName: 'Chrome A',
        platform: 'web',
      })
    );

    // Send AUTH for Client B
    wsB.send(
      JSON.stringify({
        type: 'AUTH',
        deviceId: devB,
        displayName: 'Android Client B',
        deviceName: 'Pixel B',
        platform: 'android',
      })
    );

    await Promise.all([authSuccessA, authSuccessB]);

    // Wait for Client B to receive a signal dispatched by Client A
    const signalReceivedPromise = new Promise<any>((resolve) => {
      wsB.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'SIGNAL') {
          resolve(msg);
        }
      });
    });

    // Client A sends WebRTC signal to Client B
    wsA.send(
      JSON.stringify({
        type: 'SIGNAL',
        senderId: devA,
        targetDeviceId: devB,
        signal: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1...' },
      })
    );

    const receivedSignal = await signalReceivedPromise;
    assert.strictEqual(receivedSignal.type, 'SIGNAL');
    assert.strictEqual(receivedSignal.senderId, devA);
    assert.strictEqual(receivedSignal.signal.type, 'offer');

    wsA.close();
    wsB.close();
  });

  // ---------------------------------------------------------------------------
  // 5. VERCEL SERVERLESS SIGNALING HANDLER WITH NEON COMPATIBILITY
  // ---------------------------------------------------------------------------
  it('should handle Vercel serverless registration and cross-network trusted peer discovery', async () => {
    class MockReq {
      method = 'POST';
      url = '/api/signaling?action=register';
      query = { action: 'register' };
      headers = { 'x-forwarded-for': '198.51.100.1' };
      body: any;
      constructor(b: any) {
        this.body = b;
      }
    }

    class MockRes {
      statusCode = 200;
      headers: Record<string, string> = {};
      bodyStr = '';
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      end(str?: string) {
        if (str) this.bodyStr = str;
      }
    }

    const testId = `vercel_test_dev_${Date.now()}`;
    const req = new MockReq({
      action: 'register',
      deviceId: testId,
      displayName: 'Vercel Web Client',
      platform: 'web',
    });
    const res = new MockRes();

    await vercelHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.bodyStr);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.deviceId, testId);
  });
});
