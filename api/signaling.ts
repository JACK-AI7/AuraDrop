import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool, PoolConfig } from 'pg';

// AuraDrop Production Serverless Signaling Channel (P2PFS/1 Specification)
// Triple-tier cross-device discovery:
// 1. Neon PostgreSQL durable connection pooling for multi-container Vercel discovery
// 2. Same Wi-Fi / IP subnet cluster matching
// 3. Fallback in-memory hot-path buffer for zero-latency local invocations

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

let dbPool: Pool | null = null;
let tablesInitialized = false;

function getDbPool(): Pool | null {
  if (!dbPool && process.env.DATABASE_URL) {
    try {
      const connStr = process.env.DATABASE_URL;
      const poolConfig: PoolConfig = {
        connectionString: connStr,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
      };
      if (connStr.includes('neon') || connStr.includes('sslmode=require') || !connStr.includes('localhost')) {
        poolConfig.ssl = { rejectUnauthorized: false };
      }
      dbPool = new Pool(poolConfig);
    } catch (e) {
      console.warn('[Signaling] Failed to init DB pool:', e);
    }
  }
  return dbPool;
}

async function ensureTables(pool: Pool): Promise<void> {
  if (tablesInitialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS active_peers (
        device_id VARCHAR(128) PRIMARY KEY,
        display_name VARCHAR(128) NOT NULL,
        device_name VARCHAR(128) NOT NULL,
        platform VARCHAR(64) NOT NULL DEFAULT 'web',
        client_ip VARCHAR(128) NOT NULL DEFAULT '127.0.0.1',
        visibility VARCHAR(32) NOT NULL DEFAULT 'everyone',
        last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_active_peers_last_seen ON active_peers(last_seen_at);

      CREATE TABLE IF NOT EXISTS signaling_messages (
        id BIGSERIAL PRIMARY KEY,
        target_device_id VARCHAR(128) NOT NULL,
        sender_device_id VARCHAR(128) NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_signaling_messages_target ON signaling_messages(target_device_id);
    `);
    tablesInitialized = true;
  } catch (err) {
    console.warn('[Signaling] Table init warning:', err);
  }
}

function pruneStaleMemoryPeers() {
  const now = Date.now();
  for (const [id, peer] of globalPeers.entries()) {
    if (now - peer.lastSeen > 35000) {
      globalPeers.delete(id);
      globalMessages.delete(id);
    }
  }
}

async function getActivePeers(
  pool: Pool | null,
  selfDeviceId: string,
  clientIp: string,
  visibility = 'everyone'
): Promise<PeerEntry[]> {
  const peersMap = new Map<string, PeerEntry>();

  // 1. Query Durable Database (Shared across ALL Vercel lambda instances and devices)
  if (pool) {
    try {
      await ensureTables(pool);
      const q = `
        SELECT device_id, display_name, device_name, platform, client_ip, visibility,
               EXTRACT(EPOCH FROM last_seen_at) * 1000 as last_seen
        FROM active_peers
        WHERE device_id != $1
          AND last_seen_at > NOW() - INTERVAL '35 seconds'
        ORDER BY last_seen_at DESC
        LIMIT 50;
      `;
      const res = await pool.query(q, [selfDeviceId]);
      for (const r of res.rows) {
        const isSameIp = r.client_ip === clientIp || clientIp === '127.0.0.1' || r.client_ip === '127.0.0.1';
        const isPublicEveryone = visibility === 'everyone' && r.visibility === 'everyone';
        if (isSameIp || isPublicEveryone) {
          peersMap.set(r.device_id, {
            deviceId: r.device_id,
            displayName: r.display_name,
            deviceName: r.device_name,
            platform: r.platform,
            clientIp: r.client_ip,
            lastSeen: Number(r.last_seen),
            visibility: r.visibility,
          });
        }
      }
    } catch (e) {
      console.warn('[Signaling] DB query peers notice:', e);
    }
  }

  // 2. Merge Memory Peers (Fast same-process fallback)
  for (const [id, p] of globalPeers) {
    if (id !== selfDeviceId && Date.now() - p.lastSeen < 35000) {
      const isSameIp = p.clientIp === clientIp || clientIp === '127.0.0.1' || p.clientIp === '127.0.0.1';
      const isPublicEveryone = visibility === 'everyone' && p.visibility === 'everyone';
      if (isSameIp || isPublicEveryone) {
        if (!peersMap.has(id)) peersMap.set(id, p);
      }
    }
  }

  return Array.from(peersMap.values());
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

  pruneStaleMemoryPeers();
  const pool = getDbPool();

  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
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

  // ---------------------------------------------------------------------------
  // 1. REGISTER
  // ---------------------------------------------------------------------------
  if (action === 'register') {
    const regDeviceId = deviceId || body.deviceId;
    if (!regDeviceId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'deviceId required' }));
      return;
    }

    const displayName = body.displayName || body.name || 'AuraDrop Device';
    const deviceName = body.deviceName || displayName;
    const platform = body.platform || 'web';
    const visibility = body.visibility || 'everyone';

    const peer: PeerEntry = {
      deviceId: regDeviceId,
      displayName,
      deviceName,
      platform,
      clientIp,
      lastSeen: Date.now(),
      visibility,
    };

    globalPeers.set(regDeviceId, peer);

    if (pool) {
      try {
        await ensureTables(pool);
        await pool.query(
          `
          INSERT INTO active_peers (device_id, display_name, device_name, platform, client_ip, visibility, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            device_name = EXCLUDED.device_name,
            platform = EXCLUDED.platform,
            client_ip = EXCLUDED.client_ip,
            visibility = EXCLUDED.visibility,
            last_seen_at = NOW();
        `,
          [regDeviceId, displayName, deviceName, platform, clientIp, visibility]
        );
      } catch (err) {
        console.warn('[Signaling] DB register notice:', err);
      }
    }

    const activePeers = await getActivePeers(pool, regDeviceId, clientIp, visibility);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        deviceId: regDeviceId,
        clientIp,
        peers: activePeers,
      })
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // 2. POLL (Heartbeat + discover matching peers + drain queued messages)
  // ---------------------------------------------------------------------------
  if (action === 'poll') {
    if (!deviceId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'deviceId required' }));
      return;
    }

    const name = url.searchParams.get('name') || body.displayName || 'AuraDrop Device';

    // Refresh memory lastSeen
    const current = globalPeers.get(deviceId);
    if (current) {
      current.lastSeen = Date.now();
    } else {
      globalPeers.set(deviceId, {
        deviceId,
        displayName: name,
        deviceName: name,
        platform: 'web',
        clientIp,
        lastSeen: Date.now(),
        visibility: 'everyone',
      });
    }

    // Refresh database lastSeen
    if (pool) {
      try {
        await ensureTables(pool);
        await pool.query(
          `
          INSERT INTO active_peers (device_id, display_name, device_name, platform, client_ip, visibility, last_seen_at)
          VALUES ($1, $2, $2, 'web', $3, 'everyone', NOW())
          ON CONFLICT (device_id) DO UPDATE SET last_seen_at = NOW();
        `,
          [deviceId, name, clientIp]
        ).catch(() => {});
      } catch {}
    }

    // Drain queued messages
    const messages: any[] = [];
    if (pool) {
      try {
        const msgRes = await pool.query(
          `
          DELETE FROM signaling_messages
          WHERE target_device_id = $1
          RETURNING payload_json;
        `,
          [deviceId]
        );
        for (const row of msgRes.rows) {
          messages.push(row.payload_json);
        }
      } catch (e) {
        console.warn('[Signaling] DB message drain notice:', e);
      }
    }

    const memQueue = globalMessages.get(deviceId) || [];
    globalMessages.delete(deviceId);
    messages.push(...memQueue);

    const activePeers = await getActivePeers(pool, deviceId, clientIp, 'everyone');

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        clientIp,
        peers: activePeers,
        messages,
      })
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // 3. SEND MESSAGE (WebRTC Signal, Transfer Requests, Chat)
  // ---------------------------------------------------------------------------
  if (action === 'send') {
    const target = body.targetDeviceId || body.targetId || url.searchParams.get('target');
    if (!target) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'targetDeviceId required' }));
      return;
    }

    // Memory queue
    const queue = globalMessages.get(target) || [];
    queue.push(body);
    if (queue.length > 100) queue.shift();
    globalMessages.set(target, queue);

    // Database queue for cross-instance delivery
    if (pool) {
      try {
        await ensureTables(pool);
        const sender = body.senderId || body.deviceId || 'unknown';
        await pool.query(
          `
          INSERT INTO signaling_messages (target_device_id, sender_device_id, payload_json, created_at)
          VALUES ($1, $2, $3, NOW());
        `,
          [target, sender, JSON.stringify(body)]
        );
      } catch (err) {
        console.warn('[Signaling] DB message insert notice:', err);
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, queuedFor: target }));
    return;
  }

  // ---------------------------------------------------------------------------
  // 4. LIST PEERS
  // ---------------------------------------------------------------------------
  if (action === 'peers') {
    const activePeers = await getActivePeers(pool, deviceId || '', clientIp, 'everyone');
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        clientIp,
        peers: activePeers,
      })
    );
    return;
  }

  // Default: Health / Status
  const activePeers = await getActivePeers(pool, '', clientIp, 'everyone');
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      service: 'AuraDrop Vercel Serverless Signaling',
      status: 'online',
      clientIp,
      activePeersCount: activePeers.length,
      timestamp: Date.now(),
    })
  );
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
