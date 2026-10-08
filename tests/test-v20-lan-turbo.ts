// AuraDrop V20 Direct LAN Transport & Chrome Private Network Access (PNA) Test
import http from 'node:http';
import crypto from 'node:crypto';

async function runLanTurboTest() {
  console.log('================================================================');
  console.log('🧪 TESTING AURADROP V20 DIRECT LAN TRANSPORT & CHROME PNA HEADERS');
  console.log('================================================================\n');

  // 1. Simulate the Android AuraLanServer
  const testPort = 53319;
  const tempChunks: Buffer[] = [];
  let preparedTransfer: any = null;

  const server = http.createServer((req, res) => {
    // Chrome Private Network Access Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${testPort}`);

    if (req.method === 'GET' && url.pathname === '/api/probe') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', deviceName: 'AuraDrop Android V20', port: testPort }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/transfer/prepare') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        preparedTransfer = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ accepted: true, transferId: preparedTransfer.transferId }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/transfer/upload') {
      const hasher = crypto.createHash('sha256');
      let bytesReceived = 0;

      req.on('data', chunk => {
        hasher.update(chunk);
        bytesReceived += chunk.length;
        tempChunks.push(chunk);
      });

      req.on('end', () => {
        const calculatedSha = hasher.digest('hex');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          status: 'ok',
          sha256: calculatedSha,
          bytesWritten: bytesReceived,
        }));
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>(resolve => server.listen(testPort, '127.0.0.1', () => resolve()));
  console.log(`[Step 1] Simulated AuraLanServer listening on http://127.0.0.1:${testPort}`);

  // 2. Test Chrome Preflight with Private Network Access Header
  console.log('[Step 2] Testing Chrome PNA Preflight (OPTIONS /api/probe)...');
  const optRes = await fetch(`http://127.0.0.1:${testPort}/api/probe`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://auradrop.vercel.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  if (optRes.status !== 204) throw new Error(`Expected status 204, got ${optRes.status}`);
  const allowPna = optRes.headers.get('access-control-allow-private-network');
  if (allowPna !== 'true') throw new Error(`Missing or invalid Access-Control-Allow-Private-Network: ${allowPna}`);
  console.log('  ✓ Preflight accepted with Access-Control-Allow-Private-Network: true');

  // 3. Test Probe
  console.log('[Step 3] Testing LAN Probe (GET /api/probe)...');
  const probeRes = await fetch(`http://127.0.0.1:${testPort}/api/probe`);
  const probeData = await probeRes.json();
  if (probeData.status !== 'ok') throw new Error('Probe failed');
  console.log(`  ✓ Probe succeeded: ${probeData.deviceName} on port ${probeData.port}`);

  // 4. Test Prepare Transfer
  console.log('[Step 4] Testing Prepare Transfer (POST /api/transfer/prepare)...');
  const testFilePayload = Buffer.alloc(5 * 1024 * 1024, 0x41); // 5 MB test file (byte 'A')
  const expectedSha256 = crypto.createHash('sha256').update(testFilePayload).digest('hex');

  const prepRes = await fetch(`http://127.0.0.1:${testPort}/api/transfer/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transferId: 'xfer_test_123',
      fileName: '5mb_test_video.mp4',
      fileSize: testFilePayload.length,
      sha256: expectedSha256,
      senderName: 'Chrome Web Desktop',
      senderDeviceName: 'Windows 11 PC',
    }),
  });
  const prepData = await prepRes.json();
  if (!prepData.accepted) throw new Error('Prepare transfer rejected');
  console.log(`  ✓ Prepare accepted for transfer: ${prepData.transferId}`);

  // 5. Test Direct Zero-Hop Streaming Upload with Incremental SHA-256
  console.log('[Step 5] Streaming 5 MB file directly to LAN server (POST /api/transfer/upload)...');
  const startTime = Date.now();
  const uploadRes = await fetch(`http://127.0.0.1:${testPort}/api/transfer/upload?transferId=xfer_test_123&fileName=5mb_test_video.mp4`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Transfer-Id': 'xfer_test_123',
      'X-Expected-Sha256': expectedSha256,
    },
    body: testFilePayload,
  });
  const uploadData = await uploadRes.json();
  const duration = (Date.now() - startTime) / 1000;
  const speedMBps = ((testFilePayload.length / (1024 * 1024)) / duration).toFixed(2);

  if (uploadData.sha256 !== expectedSha256) {
    throw new Error(`SHA-256 mismatch! Expected ${expectedSha256}, got ${uploadData.sha256}`);
  }
  console.log(`  ✓ Direct LAN streaming complete: 5 MB received in ${duration}s (${speedMBps} MB/s)`);
  console.log(`  ✓ SHA-256 Verified (FIPS 180-4): ${uploadData.sha256}`);

  await new Promise<void>(resolve => server.close(() => resolve()));
  console.log('\n================================================================');
  console.log('🎉 V20 DIRECT LAN TRANSPORT & CHROME PNA TESTS PASSED 100%!');
  console.log('================================================================');
}

runLanTurboTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
