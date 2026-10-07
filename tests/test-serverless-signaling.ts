import handler from '../api/signaling';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  data: string;
  setHeader(name: string, val: string): void;
  end(content?: string): void;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    data: '',
    setHeader(name, val) {
      this.headers[name] = val;
    },
    end(content) {
      if (content) this.data = content;
    },
  };
  return res;
}

async function runTest() {
  console.log('🧪 Testing AuraDrop Vercel Serverless Signaling Engine...');

  const sameWifiIp = '203.0.113.42'; // Same public Wi-Fi router IP

  // 1. Device A (Web Desktop) registers
  const reqA = {
    method: 'POST',
    url: '/api/signaling?action=register',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
    body: {
      action: 'register',
      deviceId: 'dev_laptop_1',
      displayName: 'MacBook Pro',
      deviceName: 'Chrome on macOS',
      platform: 'web',
    },
  };
  const resA = createMockRes();
  await handler(reqA, resA);
  const dataA = JSON.parse(resA.data);
  console.log('✓ Device A registered:', dataA.deviceId, 'clientIp:', dataA.clientIp);

  // 2. Device B (Mobile / Second Device) registers on same Wi-Fi
  const reqB = {
    method: 'POST',
    url: '/api/signaling?action=register',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
    body: {
      action: 'register',
      deviceId: 'dev_phone_2',
      displayName: 'Pixel 9 Pro',
      deviceName: 'Android Device',
      platform: 'android',
    },
  };
  const resB = createMockRes();
  await handler(reqB, resB);
  const dataB = JSON.parse(resB.data);
  console.log('✓ Device B registered:', dataB.deviceId, 'discovered peers:', dataB.peers.map((p: any) => p.displayName));
  if (!dataB.peers.some((p: any) => p.deviceId === 'dev_laptop_1')) {
    throw new Error('Device B did not discover Device A on the same Wi-Fi!');
  }

  // 3. Device A polls and discovers Device B
  const pollA = {
    method: 'GET',
    url: '/api/signaling?action=poll&deviceId=dev_laptop_1&name=MacBook%20Pro',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
  };
  const resPollA = createMockRes();
  await handler(pollA, resPollA);
  const pollDataA = JSON.parse(resPollA.data);
  console.log('✓ Device A polled and discovered peers:', pollDataA.peers.map((p: any) => p.displayName));
  if (!pollDataA.peers.some((p: any) => p.deviceId === 'dev_phone_2')) {
    throw new Error('Device A did not discover Device B on the same Wi-Fi!');
  }

  // 4. Device A sends WebRTC offer signal to Device B
  const sendSig = {
    method: 'POST',
    url: '/api/signaling?action=send',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
    body: {
      action: 'send',
      type: 'SIGNAL',
      senderId: 'dev_laptop_1',
      targetDeviceId: 'dev_phone_2',
      signal: { type: 'offer', sdp: 'v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\ns=-\r\n' },
    },
  };
  const resSig = createMockRes();
  await handler(sendSig, resSig);
  console.log('✓ Device A sent SDP offer signal to Device B');

  // 5. Device B polls and receives the queued signal
  const pollB = {
    method: 'GET',
    url: '/api/signaling?action=poll&deviceId=dev_phone_2&name=Pixel%209%20Pro',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
  };
  const resPollB = createMockRes();
  await handler(pollB, resPollB);
  const pollDataB = JSON.parse(resPollB.data);
  console.log('✓ Device B received queued messages count:', pollDataB.messages.length);
  if (pollDataB.messages.length === 0 || pollDataB.messages[0].type !== 'SIGNAL') {
    throw new Error('Device B did not receive the queued WebRTC signal!');
  }

  // 6. Device B sends transfer accept
  const sendAccept = {
    method: 'POST',
    url: '/api/signaling?action=send',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
    body: {
      action: 'send',
      type: 'TRANSFER_ACCEPT',
      senderId: 'dev_phone_2',
      targetDeviceId: 'dev_laptop_1',
      transferId: 'xfer_100',
      accepted: true,
    },
  };
  const resAccept = createMockRes();
  await handler(sendAccept, resAccept);
  console.log('✓ Device B sent TRANSFER_ACCEPT to Device A');

  // 7. Device A polls and receives TRANSFER_ACCEPT
  const pollA2 = {
    method: 'GET',
    url: '/api/signaling?action=poll&deviceId=dev_laptop_1&name=MacBook%20Pro',
    headers: { 'x-forwarded-for': sameWifiIp, host: 'auradrop.vercel.app' },
  };
  const resPollA2 = createMockRes();
  await handler(pollA2, resPollA2);
  const pollDataA2 = JSON.parse(resPollA2.data);
  console.log('✓ Device A received response:', pollDataA2.messages[0]?.type);
  if (pollDataA2.messages[0]?.type !== 'TRANSFER_ACCEPT') {
    throw new Error('Device A did not receive the transfer acceptance!');
  }

  console.log('\n🎉 ALL VERCEL SERVERLESS SIGNALING & SAME-WI-FI DISCOVERY TESTS PASSED 100%!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
