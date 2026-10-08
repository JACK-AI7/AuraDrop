import assert from 'node:assert';
import handler from '../api/signaling';

class MockReq {
  public method: string;
  public url: string;
  public headers: Record<string, string>;
  public body: any;
  private dataListeners: ((chunk: any) => void)[] = [];
  private endListeners: (() => void)[] = [];

  constructor(method: string, url: string, headers: Record<string, string> = {}, body?: any) {
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
  }

  on(event: string, cb: any) {
    if (event === 'data') this.dataListeners.push(cb);
    if (event === 'end') {
      this.endListeners.push(cb);
      process.nextTick(() => {
        if (this.body && typeof this.body !== 'object') {
          this.dataListeners.forEach((l) => l(this.body));
        }
        this.endListeners.forEach((l) => l());
      });
    }
    return this;
  }
}

class MockRes {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body = '';
  private doneCallback?: (res: MockRes) => void;

  constructor(done?: (res: MockRes) => void) {
    this.doneCallback = done;
  }

  setHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }

  end(data?: string) {
    if (data) this.body += data;
    if (this.doneCallback) this.doneCallback(this);
  }

  json() {
    return JSON.parse(this.body);
  }
}

function invokeSignaling(req: MockReq): Promise<MockRes> {
  return new Promise((resolve) => {
    const res = new MockRes(resolve);
    handler(req, res);
  });
}

async function testCrossTabAndDeviceDiscovery() {
  console.log('================================================================');
  console.log('🧪 TESTING REAL CROSS-TAB & CROSS-DEVICE DISCOVERY ON NEON DB');
  console.log('================================================================\n');

  const nonce = Date.now().toString(36);
  // Two tabs on the same computer (MacBook Pro)
  const tab1Id = `aura_mbp_${nonce}_tab1`;
  const tab2Id = `aura_mbp_${nonce}_receiver`;
  // Third device on mobile phone (Android / Pixel)
  const phoneId = `aura_pixel_${nonce}`;

  // 1. Register Tab 1 (Desktop Sender)
  console.log('[Step 1] Register Tab 1 (Desktop Sender)...');
  let res = await invokeSignaling(
    new MockReq(
      'POST',
      '/api/signaling?action=register',
      { 'x-forwarded-for': '192.168.1.100' },
      {
        deviceId: tab1Id,
        displayName: 'MacBook Pro (Sender)',
        deviceName: 'MacBook Pro',
        platform: 'macos',
        visibility: 'everyone',
      }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  let data = res.json();
  assert.strictEqual(data.success, true);
  console.log(`  ✓ Tab 1 registered: ${tab1Id}`);

  // 2. Register Tab 2 (Desktop Receiver Window)
  console.log('\n[Step 2] Register Tab 2 (Desktop Receiver Window)...');
  res = await invokeSignaling(
    new MockReq(
      'POST',
      '/api/signaling?action=register',
      { 'x-forwarded-for': '192.168.1.100' },
      {
        deviceId: tab2Id,
        displayName: 'MacBook Pro (Receiver)',
        deviceName: 'MacBook Pro',
        platform: 'macos',
        visibility: 'everyone',
      }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  const tab2Found = data.peers.find((p: any) => p.deviceId === tab1Id);
  assert.ok(tab2Found, 'Tab 2 MUST discover Tab 1 immediately on registration!');
  console.log(`  ✓ Tab 2 registered and immediately discovered Tab 1: "${tab2Found.displayName}"`);

  // 3. Register Phone (Mobile on Wi-Fi or cellular)
  console.log('\n[Step 3] Register Mobile Phone...');
  res = await invokeSignaling(
    new MockReq(
      'POST',
      '/api/signaling?action=register',
      { 'x-forwarded-for': '192.168.1.105' },
      {
        deviceId: phoneId,
        displayName: 'Pixel 9 Pro',
        deviceName: 'Google Pixel',
        platform: 'android',
        visibility: 'everyone',
      }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.peers.length >= 2, 'Phone MUST see both desktop tabs!');
  console.log(`  ✓ Phone registered and discovered ${data.peers.length} desktop devices:`, data.peers.map((p: any) => p.displayName));

  // 4. Tab 1 Polls and MUST see both Tab 2 and Phone
  console.log('\n[Step 4] Tab 1 polls for active peers...');
  res = await invokeSignaling(
    new MockReq(
      'GET',
      `/api/signaling?action=poll&deviceId=${tab1Id}&name=MacBook%20Pro`,
      { 'x-forwarded-for': '192.168.1.100' }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  const foundTab2 = data.peers.find((p: any) => p.deviceId === tab2Id);
  const foundPhone = data.peers.find((p: any) => p.deviceId === phoneId);
  assert.ok(foundTab2, 'Tab 1 MUST discover Tab 2 (Receiver Window)');
  assert.ok(foundPhone, 'Tab 1 MUST discover Phone');
  console.log(`  ✓ Tab 1 discovered Tab 2: "${foundTab2.displayName}"`);
  console.log(`  ✓ Tab 1 discovered Phone: "${foundPhone.displayName}"`);

  // 5. Signal from Tab 1 to Tab 2
  console.log('\n[Step 5] Tab 1 sends AirDrop offer signal to Tab 2...');
  res = await invokeSignaling(
    new MockReq(
      'POST',
      '/api/signaling?action=send',
      { 'x-forwarded-for': '192.168.1.100' },
      {
        targetDeviceId: tab2Id,
        senderId: tab1Id,
        type: 'TRANSFER_REQUEST',
        fileName: 'presentation.key',
        fileSize: 15400000,
      }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  console.log(`  ✓ Signal queued for Tab 2: target = ${tab2Id}`);

  // 6. Tab 2 polls and drains message
  console.log('\n[Step 6] Tab 2 polls and drains signal message...');
  res = await invokeSignaling(
    new MockReq(
      'GET',
      `/api/signaling?action=poll&deviceId=${tab2Id}&name=MacBook%20Pro%20Receiver`,
      { 'x-forwarded-for': '192.168.1.100' }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.messages.length > 0, 'Tab 2 MUST receive the queued message!');
  const receivedMsg = data.messages[0];
  assert.strictEqual(receivedMsg.type, 'TRANSFER_REQUEST');
  assert.strictEqual(receivedMsg.fileName, 'presentation.key');
  console.log(`  ✓ Tab 2 received message: Type = ${receivedMsg.type}, File = ${receivedMsg.fileName}`);

  console.log('\n================================================================');
  console.log('🎉 REAL CROSS-TAB & CROSS-DEVICE DISCOVERY PASSED 100%!');
  console.log('================================================================\n');
  process.exit(0);
}

testCrossTabAndDeviceDiscovery().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
