import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BackendServer } from '../apps/backend/src/server';

function getLiveDbUrl(): string {
  const p = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (line.startsWith('DATABASE_URL=')) {
        let v = line.slice('DATABASE_URL='.length).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        return v;
      }
    }
  }
  return process.env.DATABASE_URL || '';
}

async function testProductionDatabaseFailure() {
  console.log(`================================================================`);
  console.log(`🛡️ AURADROP V17 PRODUCTION DATABASE FAILURE & READINESS PROBE TEST`);
  console.log(`================================================================\n`);

  const originalEnv = process.env.NODE_ENV;
  const liveDbUrl = getLiveDbUrl();

  try {
    // -------------------------------------------------------------
    // TEST 1: Production mode with BROKEN DATABASE_URL
    // Must report 503 NOT_READY and REFUSE in-memory fallback!
    // -------------------------------------------------------------
    console.log('[Test 1] Simulating production environment with unavailable database...');
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://neondb_owner:invalid_pass@ep-broken-db.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require';

    const failServer = new BackendServer();
    const failPort = 48291;
    await failServer.listen(failPort, '127.0.0.1');

    try {
      // 1.1 /live should still return 200 (process is alive)
      const liveRes = await fetch(`http://127.0.0.1:${failPort}/live`);
      assert.strictEqual(liveRes.status, 200);
      const liveData = await liveRes.json();
      assert.strictEqual(liveData.status, 'ALIVE');
      console.log('✓ GET /live returns 200 ALIVE: PASS');

      // 1.2 /ready must return 503 NOT_READY (refusing traffic)
      const readyRes = await fetch(`http://127.0.0.1:${failPort}/ready`);
      assert.strictEqual(readyRes.status, 503);
      const readyData = await readyRes.json();
      assert.strictEqual(readyData.status, 'NOT_READY');
      assert.strictEqual(readyData.database, 'disconnected');
      console.log('✓ GET /ready returns 503 NOT_READY when Neon is down: PASS (No silent fallback!)');

      // 1.3 /auth/register must fail honestly with 503
      const regRes = await fetch(`http://127.0.0.1:${failPort}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'should_fail',
          email: 'should_fail@example.com',
          password: 'SecretPassword123!',
        }),
      });
      assert.strictEqual(regRes.status, 503);
      const regData = await regRes.json();
      assert.ok(regData.error.includes('Database service unavailable'));
      console.log('✓ POST /auth/register returns 503 (Refuses in-memory fallback in prod): PASS');
    } finally {
      await failServer.close();
    }

    // -------------------------------------------------------------
    // TEST 2: Production mode with LIVE VALID NEON DATABASE
    // Must report 200 READY and allow durable persistence!
    // -------------------------------------------------------------
    console.log('\n[Test 2] Connecting to LIVE Neon PostgreSQL database in production mode...');
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = liveDbUrl;

    const liveServer = new BackendServer();
    const livePort = 48292;
    await liveServer.listen(livePort, '127.0.0.1');

    try {
      // 2.1 /ready must return 200 READY
      const readyRes = await fetch(`http://127.0.0.1:${livePort}/ready`);
      assert.strictEqual(readyRes.status, 200);
      const readyData = await readyRes.json();
      assert.strictEqual(readyData.status, 'READY');
      assert.strictEqual(readyData.database, 'connected');
      console.log('✓ GET /ready returns 200 READY with live Neon connection: PASS');

      // 2.2 /health must report component statuses
      const healthRes = await fetch(`http://127.0.0.1:${livePort}/health`);
      assert.strictEqual(healthRes.status, 200);
      const healthData = await healthRes.json();
      assert.strictEqual(healthData.status, 'healthy');
      assert.strictEqual(healthData.components.neon.status, 'connected');
      console.log('✓ GET /health reports granular components (Neon: connected): PASS');
    } finally {
      await liveServer.close();
    }

    console.log(`\n================================================================`);
    console.log(`🎉 PRODUCTION DATABASE FAILURE & READINESS PROBE FULLY VERIFIED!`);
    console.log(`================================================================\n`);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.DATABASE_URL = liveDbUrl;
  }
}

testProductionDatabaseFailure().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
