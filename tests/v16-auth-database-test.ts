import assert from 'node:assert';
import { BackendServer } from '../apps/backend/src/server';

async function runAuthDatabaseTest() {
  console.log(`================================================================`);
  console.log(`🔐 AURADROP V16 AUTH & NEON DATABASE ENDPOINT VERIFICATION`);
  console.log(`================================================================\n`);

  const server = new BackendServer();
  const testPort = 48299;
  await server.listen(testPort, '127.0.0.1');

  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // 1. Health check
    console.log('[Step 1] Checking server health...');
    const healthRes = await fetch(`${baseUrl}/health`);
    const health = await healthRes.json();
    assert.strictEqual(health.status, 'healthy');
    console.log('✓ Backend health check: PASS');

    // 2. TURN Credentials endpoint (Section 12)
    console.log('[Step 2] Testing /api/turn-credentials (coturn HMAC-SHA1)...');
    const turnRes = await fetch(`${baseUrl}/api/turn-credentials?userId=user_jaswanth_test`);
    const turn = await turnRes.json();
    assert.ok(turn.username);
    assert.ok(turn.credential);
    assert.ok(turn.urls.length >= 3);
    console.log(`✓ Generated TURN username: ${turn.username}, credentials present: PASS`);

    // 3. Register user (Section 8)
    console.log('[Step 3] Registering new user via /auth/register...');
    const regPayload = {
      username: 'jaswanth_test',
      email: 'jaswanth@example.com',
      password: 'ProductionPassword2026!',
      displayName: 'Jaswanth Production',
    };
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload),
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    assert.strictEqual(regData.user.username, 'jaswanth_test');
    assert.ok(regData.accessToken);
    assert.ok(regData.refreshToken);
    console.log(`✓ User registered: ${regData.user.id}, Access Token issued: PASS`);

    // 4. Test duplicate registration prevention
    console.log('[Step 4] Testing duplicate registration prevention...');
    const dupRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload),
    });
    assert.strictEqual(dupRes.status, 409);
    console.log('✓ Duplicate registration rejected (409 Conflict): PASS');

    // 5. Test Login (Section 8)
    console.log('[Step 5] Testing user login via /auth/login...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'jaswanth@example.com',
        password: 'ProductionPassword2026!',
        deviceId: 'dev_test_mac_01',
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.accessToken);
    assert.ok(loginData.refreshToken);
    console.log('✓ Login verified, bcrypt hash authenticated: PASS');

    // 6. Test Profile /auth/me
    console.log('[Step 6] Testing authenticated /auth/me...');
    const meRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.accessToken}` },
    });
    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.user.email, 'jaswanth@example.com');
    assert.strictEqual(meData.preferences.default_visibility, 'EVERYONE');
    console.log('✓ Profile retrieved with default preferences: PASS');

    // 7. Test Refresh Token Rotation (Section 8 & 9)
    console.log('[Step 7] Testing refresh token rotation...');
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: loginData.refreshToken }),
    });
    assert.strictEqual(refreshRes.status, 200);
    const refreshData = await refreshRes.json();
    assert.ok(refreshData.accessToken);
    assert.ok(refreshData.refreshToken);
    assert.notStrictEqual(refreshData.refreshToken, loginData.refreshToken);
    console.log('✓ Refresh token successfully rotated: PASS');

    // 8. Test Old Refresh Token Rejection (anti-replay)
    console.log('[Step 8] Testing replay of rotated refresh token...');
    const replayRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: loginData.refreshToken }),
    });
    assert.strictEqual(replayRes.status, 401);
    console.log('✓ Replayed refresh token rejected: PASS');

    // 9. Test Visibility Setting (Section 8 & 9)
    console.log('[Step 9] Testing visibility mode update...');
    const visPutRes = await fetch(`${baseUrl}/visibility`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${refreshData.accessToken}`,
      },
      body: JSON.stringify({ mode: 'CONTACTS' }),
    });
    assert.strictEqual(visPutRes.status, 200);

    const visGetRes = await fetch(`${baseUrl}/visibility`, {
      headers: { Authorization: `Bearer ${refreshData.accessToken}` },
    });
    const visGetData = await visGetRes.json();
    assert.strictEqual(visGetData.mode, 'CONTACTS');
    console.log('✓ Visibility set and retrieved: PASS');

    console.log(`\n================================================================`);
    console.log(`🎉 ALL AUTH & DATABASE REPOSITORY TESTS PASSED SUCCESSFULLY!`);
    console.log(`================================================================\n`);
  } finally {
    await server.close();
  }
}

runAuthDatabaseTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
