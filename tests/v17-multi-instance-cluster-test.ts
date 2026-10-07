import assert from 'node:assert';
import WebSocket from 'ws';
import { BackendServer } from '../apps/backend/src/server';

async function testHorizontalClusterSignaling() {
  console.log(`================================================================`);
  console.log(`🌐 AURADROP V17 MULTI-INSTANCE HORIZONTAL CLUSTER RELAY TEST`);
  console.log(`================================================================\n`);

  // Start Instance A on Port 48293
  console.log('[Setup] Starting Server Instance A on port 48293...');
  const serverA = new BackendServer();
  const portA = 48293;
  await serverA.listen(portA, '127.0.0.1');

  // Start Instance B on Port 48294
  console.log('[Setup] Starting Server Instance B on port 48294...');
  const serverB = new BackendServer();
  const portB = 48294;
  await serverB.listen(portB, '127.0.0.1');
  const deviceAId = 'dev_desktop_node_a';
  const deviceBId = 'dev_android_node_b';

  function connectAndRegister(port: number, deviceId: string, displayName: string, platform: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'REGISTER',
            deviceId,
            payload: {
              displayName,
              platform,
              visibility: 'everyone',
            },
          })
        );
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'REGISTERED') {
          console.log(`✓ Client registered on port ${port}: ${deviceId}`);
          resolve(ws);
        }
      });
      ws.on('error', reject);
    });
  }

  let clientASocket: WebSocket | null = null;
  let clientBSocket: WebSocket | null = null;

  try {
    // 1. Connect Client A to Server A
    clientASocket = await connectAndRegister(portA, deviceAId, 'Desktop Workstation (Instance A)', 'windows');

    // 2. Connect Client B to Server B
    clientBSocket = await connectAndRegister(portB, deviceBId, 'Pixel Phone (Instance B)', 'android');

    // 3. Test Inter-Instance WebRTC Signal Relay (Client A on Server A -> Client B on Server B)
    console.log('\n[Step 3] Testing cross-instance WebRTC Offer relay (Server A -> Cluster -> Server B)...');
    const sdpOffer = 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=AuraDrop Cluster Test\r\nt=0 0\r\n';

    const offerRelayPromise = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SIGNAL' && msg.senderId === deviceAId) {
          assert.strictEqual(msg.signal.sdp, sdpOffer);
          console.log('✓ Client B received WebRTC Offer relayed across cluster boundary from Client A!');
          clientBSocket.off('message', handler);
          resolve();
        }
      };
      clientBSocket.on('message', handler);

      clientASocket.send(
        JSON.stringify({
          type: 'SIGNAL',
          senderId: deviceAId,
          targetDeviceId: deviceBId,
          signal: { type: 'offer', sdp: sdpOffer },
        })
      );
    });

    await offerRelayPromise;

    // 4. Test Cross-Instance WebRTC Answer Relay (Client B on Server B -> Cluster -> Client A on Server A)
    console.log('\n[Step 4] Testing cross-instance WebRTC Answer relay (Server B -> Cluster -> Server A)...');
    const sdpAnswer = 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=AuraDrop Cluster Test Answer\r\nt=0 0\r\n';

    const answerRelayPromise = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SIGNAL' && msg.senderId === deviceBId) {
          assert.strictEqual(msg.signal.sdp, sdpAnswer);
          console.log('✓ Client A received WebRTC Answer relayed across cluster boundary from Client B!');
          clientASocket.off('message', handler);
          resolve();
        }
      };
      clientASocket.on('message', handler);

      clientBSocket.send(
        JSON.stringify({
          type: 'SIGNAL',
          senderId: deviceBId,
          targetDeviceId: deviceAId,
          signal: { type: 'answer', sdp: sdpAnswer },
        })
      );
    });

    await answerRelayPromise;

    // 5. Test Cross-Instance Transfer Request Handshake
    console.log('\n[Step 5] Testing cross-instance TRANSFER_REQUEST & TRANSFER_ACCEPT handshake...');
    const transferHandshakePromise = new Promise<void>((resolve) => {
      // Client B listens for request and responds with accept
      const bHandler = (data: Buffer | string) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'TRANSFER_REQUEST' && msg.senderId === deviceAId) {
          console.log('✓ Client B received TRANSFER_REQUEST across cluster. Sending TRANSFER_ACCEPT...');
          clientBSocket.off('message', bHandler);
          clientBSocket.send(
            JSON.stringify({
              type: 'TRANSFER_ACCEPT',
              senderId: deviceBId,
              targetDeviceId: deviceAId,
              payload: { transferId: msg.payload.transferId },
            })
          );
        }
      };
      clientBSocket.on('message', bHandler);

      // Client A listens for accept
      const aHandler = (data: Buffer | string) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'TRANSFER_ACCEPT' && msg.senderId === deviceBId) {
          console.log('✓ Client A received TRANSFER_ACCEPT across cluster!');
          clientASocket.off('message', aHandler);
          resolve();
        }
      };
      clientASocket.on('message', aHandler);

      // Client A initiates request
      clientASocket.send(
        JSON.stringify({
          type: 'TRANSFER_REQUEST',
          senderId: deviceAId,
          targetDeviceId: deviceBId,
          payload: {
            transferId: 'tx_cluster_test_01',
            fileName: 'cluster_verification.iso',
            totalBytes: 524288000,
            fileCount: 1,
          },
        })
      );
    });

    await transferHandshakePromise;

    console.log(`\n================================================================`);
    console.log(`🎉 HORIZONTAL SIGNALING CLUSTER RELAY 100% VERIFIED!`);
    console.log(`================================================================\n`);
  } finally {
    clientASocket.terminate();
    clientBSocket.terminate();
    await serverA.close();
    await serverB.close();
  }
}

testHorizontalClusterSignaling().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
