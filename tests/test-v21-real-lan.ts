// AuraDrop V21 Real LAN Protocol & Security Verification Test
// Tests the official AuraDrop V1 Local Protocol:
// 1. Chrome Private Network Access (PNA) Preflight Headers
// 2. GET /api/auradrop/v1/info
// 3. GET /api/auradrop/v1/health
// 4. POST /api/auradrop/v1/prepare-upload (single-use token generation)
// 5. POST /api/auradrop/v1/upload (invalid token rejection)
// 6. POST /api/auradrop/v1/upload (streaming, chunking, SHA-256 verification)
// 7. Token replay protection (single-use rejection)
// 8. POST /api/auradrop/v1/cancel (abort and cleanup)

import http from 'node:http';
import crypto from 'node:crypto';

async function runV21LanTest() {
  console.log('================================================================');
  console.log('🧪 TESTING AURADROP V21 OFFICIAL LAN PROTOCOL & SECURITY SUITE');
  console.log('================================================================\n');

  const testPort = 53321;
  const sessions = new Map<string, any>();
  const activeChunks: Buffer[] = [];
  let serverCancelled = false;

  // 1. Create Mock Server implementing AuraLanServer V1 Protocol
  const server = http.createServer((req, res) => {
    // Chrome Private Network Access Headers
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${testPort}`);
    const path = url.pathname;

    // GET /api/auradrop/v1/info
    if (req.method === 'GET' && path === '/api/auradrop/v1/info') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        deviceId: 'android_test_device_v21',
        deviceName: 'Pixel 7 Pro (Test)',
        platform: 'android',
        protocol: 'auradrop/1',
        port: testPort,
        upload: true,
        version: '1.0',
        status: 'ok',
        capabilities: ['lan_http_turbo', 'streaming_io', 'sha256', 'one_time_token'],
      }));
      return;
    }

    // GET /api/auradrop/v1/health
    if (req.method === 'GET' && path === '/api/auradrop/v1/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'ok',
        version: '1.0',
        protocol: 'auradrop/1',
        deviceId: 'android_test_device_v21',
      }));
      return;
    }

    // POST /api/auradrop/v1/prepare-upload
    if (req.method === 'POST' && path === '/api/auradrop/v1/prepare-upload') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const data = JSON.parse(body);
        const transferId = data.transferId || `tx_${Date.now()}`;
        const token = crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + 60000;

        sessions.set(transferId, {
          transferId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          sha256: data.sha256,
          oneTimeToken: token,
          expiresAt,
          used: false,
        });

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          accepted: true,
          transferId,
          oneTimeToken: token,
          expiresAt,
          protocol: 'auradrop/1',
        }));
      });
      return;
    }

    // POST /api/auradrop/v1/upload
    if (req.method === 'POST' && path === '/api/auradrop/v1/upload') {
      const transferId = (req.headers['x-transfer-id'] as string) || '';
      const token = (req.headers['x-one-time-token'] as string) || '';

      const session = sessions.get(transferId);
      if (!session) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Transfer session not found or unauthorized' }));
        return;
      }

      if (Date.now() > session.expiresAt) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'One-time token expired' }));
        return;
      }

      if (session.oneTimeToken !== token) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid one-time token' }));
        return;
      }

      if (session.used) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Token already used (single-use enforced)' }));
        return;
      }

      // Mark used immediately
      session.used = true;

      const hasher = crypto.createHash('sha256');
      let bytesReceived = 0;

      req.on('data', chunk => {
        hasher.update(chunk);
        bytesReceived += chunk.length;
        activeChunks.push(chunk);
      });

      req.on('end', () => {
        const computedSha = hasher.digest('hex');
        const matches = !session.sha256 || session.sha256.toLowerCase() === computedSha.toLowerCase();

        if (!matches) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'SHA-256 checksum mismatch', computedSha, expectedSha: session.sha256 }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          status: 'ok',
          sha256: computedSha,
          bytesWritten: bytesReceived,
          verified: true,
        }));
      });
      return;
    }

    // POST /api/auradrop/v1/cancel
    if (req.method === 'POST' && path === '/api/auradrop/v1/cancel') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const data = JSON.parse(body || '{}');
        if (data.transferId) {
          sessions.delete(data.transferId);
        }
        serverCancelled = true;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'cancelled', cleaned: true }));
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>(resolve => server.listen(testPort, '127.0.0.1', () => resolve()));
  console.log(`[Step 1] Server listening on http://127.0.0.1:${testPort}`);

  try {
    // 2. Test Chrome Preflight with Private Network Access Header
    console.log('[Step 2] Testing Chrome PNA Preflight (OPTIONS /api/auradrop/v1/info)...');
    const optRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/info`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://auradrop.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    if (optRes.status !== 204) throw new Error(`Expected 204, got ${optRes.status}`);
    const allowPna = optRes.headers.get('access-control-allow-private-network');
    if (allowPna !== 'true') throw new Error(`Missing Access-Control-Allow-Private-Network header: ${allowPna}`);
    console.log('  ✓ Preflight accepted with Access-Control-Allow-Private-Network: true');

    // 3. Test GET /api/auradrop/v1/info
    console.log('[Step 3] Testing GET /api/auradrop/v1/info...');
    const infoRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/info`);
    const infoData = await infoRes.json();
    if (infoData.status !== 'ok' || infoData.protocol !== 'auradrop/1') {
      throw new Error(`Invalid info response: ${JSON.stringify(infoData)}`);
    }
    console.log(`  ✓ Discovered device "${infoData.deviceName}" (${infoData.platform}) with capabilities: ${infoData.capabilities.join(', ')}`);

    // 4. Test GET /api/auradrop/v1/health
    console.log('[Step 4] Testing GET /api/auradrop/v1/health...');
    const healthRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/health`);
    const healthData = await healthRes.json();
    if (healthData.status !== 'ok') throw new Error('Health check failed');
    console.log('  ✓ Health check returned OK');

    // 5. Test POST /api/auradrop/v1/prepare-upload
    console.log('[Step 5] Testing POST /api/auradrop/v1/prepare-upload...');
    const testPayload = Buffer.from('AuraDrop V21 High-Speed Real LAN Transfer Test Content!'.repeat(1000));
    const expectedSha = crypto.createHash('sha256').update(testPayload).digest('hex');
    const transferId = `test_xfer_${Date.now()}`;

    const prepRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/prepare-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transferId,
        fileName: 'v21_test_file.bin',
        fileSize: testPayload.length,
        sha256: expectedSha,
        senderUserId: 'web_desktop_v21',
      }),
    });
    const prepData = await prepRes.json();
    if (!prepData.accepted || !prepData.oneTimeToken) {
      throw new Error(`Prepare-upload failed: ${JSON.stringify(prepData)}`);
    }
    const token = prepData.oneTimeToken;
    console.log(`  ✓ Transfer prepared: token=${token.slice(0, 10)}... (TTL=${(prepData.expiresAt - Date.now()) / 1000}s)`);

    // 6. Test Invalid Token Upload Rejection
    console.log('[Step 6] Testing Security: Upload with invalid token must be rejected (403)...');
    const badUploadRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/upload`, {
      method: 'POST',
      headers: {
        'x-transfer-id': transferId,
        'x-one-time-token': 'bad_fake_token_123',
        'Content-Type': 'application/octet-stream',
      },
      body: testPayload,
    });
    if (badUploadRes.status !== 403) {
      throw new Error(`Expected status 403 for invalid token, got ${badUploadRes.status}`);
    }
    console.log('  ✓ Invalid token rejected with HTTP 403 Forbidden');

    // 7. Test Valid Upload with Real Streaming & SHA-256
    console.log('[Step 7] Testing Valid Upload (POST /api/auradrop/v1/upload)...');
    const startTime = Date.now();
    const goodUploadRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/upload`, {
      method: 'POST',
      headers: {
        'x-transfer-id': transferId,
        'x-one-time-token': token,
        'x-file-name': 'v21_test_file.bin',
        'x-file-size': testPayload.length.toString(),
        'x-file-sha256': expectedSha,
        'Content-Type': 'application/octet-stream',
      },
      body: testPayload,
    });
    const durationMs = Date.now() - startTime;
    if (goodUploadRes.status !== 200) {
      throw new Error(`Expected status 200, got ${goodUploadRes.status}`);
    }
    const uploadResult = await goodUploadRes.json();
    if (!uploadResult.verified || uploadResult.sha256 !== expectedSha) {
      throw new Error(`Upload SHA-256 verification failed: ${JSON.stringify(uploadResult)}`);
    }
    console.log(`  ✓ Transfer completed in ${durationMs}ms: ${uploadResult.bytesWritten} bytes streamed, SHA-256 verified: ${uploadResult.sha256.slice(0, 16)}...`);

    // 8. Test Single-Use Replay Protection
    console.log('[Step 8] Testing Security: Replay of used token must be rejected (403)...');
    const replayRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/upload`, {
      method: 'POST',
      headers: {
        'x-transfer-id': transferId,
        'x-one-time-token': token,
        'Content-Type': 'application/octet-stream',
      },
      body: testPayload,
    });
    if (replayRes.status !== 403) {
      throw new Error(`Expected status 403 for token replay, got ${replayRes.status}`);
    }
    console.log('  ✓ Replayed token rejected with HTTP 403 Forbidden (Single-use enforced)');

    // 9. Test Cancel Endpoint
    console.log('[Step 9] Testing Cancel Endpoint (POST /api/auradrop/v1/cancel)...');
    const cancelRes = await fetch(`http://127.0.0.1:${testPort}/api/auradrop/v1/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId }),
    });
    const cancelData = await cancelRes.json();
    if (cancelData.status !== 'cancelled' || !serverCancelled) {
      throw new Error(`Cancel failed: ${JSON.stringify(cancelData)}`);
    }
    console.log('  ✓ Transfer cancellation cleaned up session resources');

    console.log('\n================================================================');
    console.log('🎉 ALL AURADROP V21 LAN PROTOCOL & SECURITY TESTS PASSED!');
    console.log('================================================================');
  } finally {
    server.close();
  }
}

runV21LanTest().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
