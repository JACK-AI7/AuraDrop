import type { IncomingMessage, ServerResponse } from 'node:http';

// AuraDrop Vercel Serverless Signaling Channel (P2PFS/1 Specification)
// Enables instant zero-config discovery & WebRTC signaling for devices on the same Wi-Fi / NAT.

interface PeerEntry {
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: string;
  clientIp: string;
  lastSeen: number;
  visibility: string;
}

// In-memory cache persisted across warm serverless invocations
const globalPeers = (globalThis as any).__auradrop_peers || new Map<string, PeerEntry>();
const globalMessages = (globalThis as any).__auradrop_messages || new Map<string, any[]>();

(globalThis as any).__auradrop_peers = globalPeers;
(globalThis as any).__auradrop_messages = globalMessages;

function pruneStalePeers() {
  const now = Date.now();
  for (const [id, peer] of globalPeers.entries()) {
    if (now - peer.lastSeen > 25000) { // 25s timeout
      globalPeers.delete(id);
      globalMessages.delete(id);
    }
  }
}

export default async function handler(req: any, res: any) {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  pruneStalePeers();

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1';

  // Parse query & body
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let action = url.searchParams.get('action') || '';
  let deviceId = url.searchParams.get('deviceId') || '';

  let body: any = {};
  if (req.method === 'POST') {
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else {
      try {
        const raw = await readRequestBody(req);
        if (raw) body = JSON.parse(raw);
      } catch {}
    }
    action = action || body.action || '';
    deviceId = deviceId || body.deviceId || '';
  }

  // 1. REGISTER
  if (action === 'register') {
    const regDeviceId = deviceId || body.deviceId;
    if (!regDeviceId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'deviceId required' }));
      return;
    }

    const peer: PeerEntry = {
      deviceId: regDeviceId,
      displayName: body.displayName || body.name || 'AuraDrop Device',
      deviceName: body.deviceName || body.displayName || 'Web Browser',
      platform: body.platform || 'web',
      clientIp,
      lastSeen: Date.now(),
      visibility: body.visibility || 'everyone',
    };

    globalPeers.set(regDeviceId, peer);

    // Return peers on the same local Wi-Fi / IP (excluding self)
    const activePeers = Array.from(globalPeers.values())
      .filter((p: PeerEntry) => p.deviceId !== regDeviceId && (p.clientIp === clientIp || clientIp === '127.0.0.1'));

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      deviceId: regDeviceId,
      clientIp,
      peers: activePeers,
    }));
    return;
  }

  // 2. POLL (Heartbeat + get matching Wi-Fi peers + drain messages)
  if (action === 'poll') {
    if (!deviceId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'deviceId required' }));
      return;
    }

    // Refresh lastSeen
    const current = globalPeers.get(deviceId);
    if (current) {
      current.lastSeen = Date.now();
    } else {
      globalPeers.set(deviceId, {
        deviceId,
        displayName: url.searchParams.get('name') || 'AuraDrop Device',
        deviceName: 'Web Browser',
        platform: 'web',
        clientIp,
        lastSeen: Date.now(),
        visibility: 'everyone',
      });
    }

    // Active peers on same Wi-Fi / IP
    const activePeers = Array.from(globalPeers.values())
      .filter((p: PeerEntry) => p.deviceId !== deviceId && (p.clientIp === clientIp || clientIp === '127.0.0.1'));

    // Drain queued messages
    const queue = globalMessages.get(deviceId) || [];
    globalMessages.delete(deviceId);

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      clientIp,
      peers: activePeers,
      messages: queue,
    }));
    return;
  }

  // 3. SEND MESSAGE (Signal offer/answer/ICE, transfer requests/acceptances)
  if (action === 'send') {
    const target = body.targetDeviceId || body.targetId || url.searchParams.get('target');
    if (!target) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'targetDeviceId required' }));
      return;
    }

    const queue = globalMessages.get(target) || [];
    queue.push(body);
    if (queue.length > 100) queue.shift(); // Limit queue memory
    globalMessages.set(target, queue);

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, queuedFor: target }));
    return;
  }

  // 4. LIST PEERS
  if (action === 'peers') {
    const activePeers = Array.from(globalPeers.values())
      .filter((p: PeerEntry) => p.deviceId !== deviceId && (p.clientIp === clientIp || clientIp === '127.0.0.1'));

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      clientIp,
      peers: activePeers,
    }));
    return;
  }

  // Default: Health / Status
  res.statusCode = 200;
  res.end(JSON.stringify({
    service: 'AuraDrop Vercel Serverless Signaling',
    status: 'online',
    clientIp,
    activePeersCount: globalPeers.size,
    timestamp: Date.now(),
  }));
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });
}
