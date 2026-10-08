import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool, PoolConfig } from 'pg';
import crypto from 'node:crypto';

// AuraDrop Production Serverless Signaling Channel (P2PFS/1 & V24 Specification)
// Triple-tier cross-device discovery:
// 1. Neon PostgreSQL durable connection pooling for multi-container Vercel discovery
// 2. Persistent trusted-device pairing relationships across any network / cellular / Wi-Fi
// 3. Fallback in-memory hot-path buffer for zero-latency local invocations

interface PeerEntry {
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: string;
  clientIp: string;
  localIp?: string;
  localPort?: number;
  capabilities?: string[];
  lastSeen: number;
  visibility: string;
  isTrusted?: boolean;
}

// In-memory cache persisted across warm serverless invocations
const globalPeers = (globalThis as any).__auradrop_peers || new Map<string, PeerEntry>();
const globalMessages = (globalThis as any).__auradrop_messages || new Map<string, any[]>();
const globalTrustedPairings = (globalThis as any).__auradrop_pairings || new Map<string, Set<string>>();

(globalThis as any).__auradrop_peers = globalPeers;
(globalThis as any).__auradrop_messages = globalMessages;
(globalThis as any).__auradrop_pairings = globalTrustedPairings;

function addMemoryPair(a: string, b: string) {
  if (!globalTrustedPairings.has(a)) globalTrustedPairings.set(a, new Set());
  if (!globalTrustedPairings.has(b)) globalTrustedPairings.set(b, new Set());
  globalTrustedPairings.get(a).add(b);
  globalTrustedPairings.get(b).add(a);
}

function isMemoryPaired(a: string, b: string): boolean {
  return globalTrustedPairings.get(a)?.has(b) || false;
}

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
        local_ip VARCHAR(128),
        local_port INTEGER,
        capabilities JSONB,
        visibility VARCHAR(32) NOT NULL DEFAULT 'everyone',
        last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      ALTER TABLE active_peers ADD COLUMN IF NOT EXISTS local_ip VARCHAR(128);
      ALTER TABLE active_peers ADD COLUMN IF NOT EXISTS local_port INTEGER;
      ALTER TABLE active_peers ADD COLUMN IF NOT EXISTS capabilities JSONB;
      CREATE INDEX IF NOT EXISTS idx_active_peers_last_seen ON active_peers(last_seen_at);

      CREATE TABLE IF NOT EXISTS signaling_messages (
        id BIGSERIAL PRIMARY KEY,
        target_device_id VARCHAR(128) NOT NULL,
        sender_device_id VARCHAR(128) NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_signaling_messages_target ON signaling_messages(target_device_id);

      CREATE TABLE IF NOT EXISTS trusted_device_pairings (
        device_id_a VARCHAR(128) NOT NULL,
        device_id_b VARCHAR(128) NOT NULL,
        relationship_id VARCHAR(128) NOT NULL,
        auth_token VARCHAR(256),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        PRIMARY KEY (device_id_a, device_id_b)
      );
      CREATE INDEX IF NOT EXISTS idx_trusted_pairings_a ON trusted_device_pairings(device_id_a);
      CREATE INDEX IF NOT EXISTS idx_trusted_pairings_b ON trusted_device_pairings(device_id_b);
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
  visibility = 'everyone',
  trustedPeers: string[] = []
): Promise<PeerEntry[]> {
  const peersMap = new Map<string, PeerEntry>();
  const trustedSet = new Set<string>(trustedPeers);

  // 1. Query Durable Database (Shared across ALL Vercel lambda instances and devices)
  if (pool) {
    try {
      await ensureTables(pool);

      // Load DB trusted relationships for this device
      if (selfDeviceId) {
        try {
          const pairRes = await pool.query(
            `SELECT device_id_a, device_id_b FROM trusted_device_pairings WHERE device_id_a = $1 OR device_id_b = $1`,
            [selfDeviceId]
          );
          for (const row of pairRes.rows) {
            const other = row.device_id_a === selfDeviceId ? row.device_id_b : row.device_id_a;
            trustedSet.add(other);
            addMemoryPair(selfDeviceId, other);
          }
        } catch {}
      }

      const q = `
        SELECT device_id, display_name, device_name, platform, client_ip, local_ip, local_port, capabilities, visibility,
               EXTRACT(EPOCH FROM last_seen_at) * 1000 as last_seen
        FROM active_peers
        WHERE device_id != $1
          AND last_seen_at > NOW() - INTERVAL '35 seconds'
        ORDER BY last_seen_at DESC
        LIMIT 50;
      `;
      const res = await pool.query(q, [selfDeviceId]);
      for (const r of res.rows) {
        const isTrusted = trustedSet.has(r.device_id) || isMemoryPaired(selfDeviceId, r.device_id);
        const isSameIp = r.client_ip === clientIp || clientIp === '127.0.0.1' || r.client_ip === '127.0.0.1';
        const isPublicEveryone = visibility === 'everyone' && r.visibility === 'everyone';
        // Trusted devices ALWAYS match regardless of client IP / Wi-Fi subnet!
        if (isTrusted || isSameIp || isPublicEveryone) {
          peersMap.set(r.device_id, {
            deviceId: r.device_id,
            displayName: r.display_name,
            deviceName: r.device_name,
            platform: r.platform,
            clientIp: r.client_ip,
            localIp: r.local_ip || undefined,
            localPort: r.local_port ? Number(r.local_port) : undefined,
            capabilities: r.capabilities || undefined,
            lastSeen: Number(r.last_seen),
            visibility: r.visibility,
            isTrusted: isTrusted || undefined,
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
      const isTrusted = trustedSet.has(id) || isMemoryPaired(selfDeviceId, id);
      const isSameIp = p.clientIp === clientIp || clientIp === '127.0.0.1' || p.clientIp === '127.0.0.1';
      const isPublicEveryone = visibility === 'everyone' && p.visibility === 'everyone';
      if (isTrusted || isSameIp || isPublicEveryone) {
        if (!peersMap.has(id)) {
          peersMap.set(id, { ...p, isTrusted: isTrusted || undefined });
        }
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
  const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
  let action = (req.query?.action as string) || url.searchParams.get('action') || '';
  let deviceId = (req.query?.deviceId as string) || url.searchParams.get('deviceId') || '';

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
    action = body.action || action || '';
    deviceId = body.deviceId || deviceId || '';
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
    const localIp = body.localIp || url.searchParams.get('localIp') || undefined;
    const localPort = body.localPort ? Number(body.localPort) : (url.searchParams.get('localPort') ? Number(url.searchParams.get('localPort')) : undefined);
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : undefined;

    const peer: PeerEntry = {
      deviceId: regDeviceId,
      displayName,
      deviceName,
      platform,
      clientIp,
      localIp,
      localPort,
      capabilities,
      lastSeen: Date.now(),
      visibility,
    };

    globalPeers.set(regDeviceId, peer);

    if (pool) {
      try {
        await ensureTables(pool);
        await pool.query(
          `
          INSERT INTO active_peers (device_id, display_name, device_name, platform, client_ip, local_ip, local_port, capabilities, visibility, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            device_name = EXCLUDED.device_name,
            platform = EXCLUDED.platform,
            client_ip = EXCLUDED.client_ip,
            local_ip = COALESCE(EXCLUDED.local_ip, active_peers.local_ip),
            local_port = COALESCE(EXCLUDED.local_port, active_peers.local_port),
            capabilities = COALESCE(EXCLUDED.capabilities, active_peers.capabilities),
            visibility = EXCLUDED.visibility,
            last_seen_at = NOW();
        `,
          [regDeviceId, displayName, deviceName, platform, clientIp, localIp || null, localPort || null, capabilities ? JSON.stringify(capabilities) : null, visibility]
        );
      } catch (err) {
        console.warn('[Signaling] DB register notice:', err);
      }
    }

    const queryTrustedReg = (req.query?.trustedPeers as string) || url.searchParams.get('trustedPeers');
    const trustedPeers: string[] = Array.isArray(body.trustedPeers)
      ? body.trustedPeers
      : queryTrustedReg
      ? queryTrustedReg.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    for (const tId of trustedPeers) {
      addMemoryPair(regDeviceId, tId);
    }
    const activePeers = await getActivePeers(pool, regDeviceId, clientIp, visibility, trustedPeers);

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

    const name = (req.query?.name as string) || url.searchParams.get('name') || body.displayName || 'AuraDrop Device';
    const reqPlatform = (req.query?.platform as string) || url.searchParams.get('platform') || body.platform || (globalPeers.get(deviceId)?.platform) || 'web';
    const reqDeviceName = (req.query?.deviceName as string) || url.searchParams.get('deviceName') || body.deviceName || name;
    const reqVisibility = (req.query?.visibility as string) || url.searchParams.get('visibility') || body.visibility || 'everyone';
    const localIp = body.localIp || (req.query?.localIp as string) || url.searchParams.get('localIp') || undefined;
    const localPort = body.localPort ? Number(body.localPort) : (req.query?.localPort ? Number(req.query.localPort) : (url.searchParams.get('localPort') ? Number(url.searchParams.get('localPort')) : undefined));
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : undefined;
    const queryTrustedPoll = (req.query?.trustedPeers as string) || url.searchParams.get('trustedPeers');
    const trustedPeers: string[] = Array.isArray(body.trustedPeers)
      ? body.trustedPeers
      : queryTrustedPoll
      ? queryTrustedPoll.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    for (const tId of trustedPeers) {
      addMemoryPair(deviceId, tId);
    }

    // Refresh memory lastSeen
    const current = globalPeers.get(deviceId);
    if (current) {
      current.lastSeen = Date.now();
      if (reqPlatform && reqPlatform !== 'web') {
        current.platform = reqPlatform;
      }
      if (localIp) current.localIp = localIp;
      if (localPort) current.localPort = localPort;
      if (capabilities) current.capabilities = capabilities;
    } else {
      globalPeers.set(deviceId, {
        deviceId,
        displayName: name,
        deviceName: reqDeviceName,
        platform: reqPlatform,
        clientIp,
        localIp,
        localPort,
        capabilities,
        lastSeen: Date.now(),
        visibility: reqVisibility,
      });
    }

    // Refresh database lastSeen
    if (pool) {
      try {
        await ensureTables(pool);
        await pool.query(
          `
          INSERT INTO active_peers (device_id, display_name, device_name, platform, client_ip, local_ip, local_port, capabilities, visibility, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            last_seen_at = NOW(),
            client_ip = EXCLUDED.client_ip,
            display_name = CASE WHEN EXCLUDED.display_name != 'AuraDrop Device' THEN EXCLUDED.display_name ELSE active_peers.display_name END,
            device_name = CASE WHEN EXCLUDED.device_name != 'AuraDrop Device' THEN EXCLUDED.device_name ELSE active_peers.device_name END,
            platform = CASE WHEN EXCLUDED.platform != 'web' THEN EXCLUDED.platform ELSE active_peers.platform END,
            local_ip = COALESCE(EXCLUDED.local_ip, active_peers.local_ip),
            local_port = COALESCE(EXCLUDED.local_port, active_peers.local_port),
            capabilities = COALESCE(EXCLUDED.capabilities, active_peers.capabilities);
        `,
          [deviceId, name, reqDeviceName, reqPlatform, clientIp, localIp || null, localPort || null, capabilities ? JSON.stringify(capabilities) : null, reqVisibility]
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

    const activePeers = await getActivePeers(pool, deviceId, clientIp, 'everyone', trustedPeers);

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
  // 3. PAIR (V24 Persistent Authorization Handshake)
  // ---------------------------------------------------------------------------
  if (action === 'pair') {
    const deviceA = deviceId || body.deviceId || body.initiatorDeviceId;
    const deviceB = body.targetDeviceId;
    const relationshipId = body.relationshipId || `rel_${Date.now()}`;
    const authToken = body.authToken || body.pairingToken || `tok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    if (!deviceA || !deviceB) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'deviceId and targetDeviceId required' }));
      return;
    }

    addMemoryPair(deviceA, deviceB);

    if (pool) {
      try {
        await ensureTables(pool);
        await pool.query(
          `INSERT INTO trusted_device_pairings (device_id_a, device_id_b, relationship_id, auth_token, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (device_id_a, device_id_b) DO UPDATE SET relationship_id = EXCLUDED.relationship_id;`,
          [deviceA, deviceB, relationshipId, authToken]
        );
      } catch (err) {
        console.warn('[Signaling] DB pair notice:', err);
      }
    }

    // Queue confirmation message to target device
    const pairNotif = {
      type: 'PAIR_CONFIRMED',
      relationshipId,
      pairedWith: deviceA,
      timestamp: Date.now(),
    };
    const targetQueue = globalMessages.get(deviceB) || [];
    targetQueue.push(pairNotif);
    globalMessages.set(deviceB, targetQueue);

    if (pool) {
      pool.query(
        `INSERT INTO signaling_messages (target_device_id, sender_device_id, payload_json, created_at) VALUES ($1, $2, $3, NOW());`,
        [deviceB, deviceA, JSON.stringify(pairNotif)]
      ).catch(() => {});
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, relationshipId, paired: true, pairingToken: authToken }));
    return;
  }

  // ---------------------------------------------------------------------------
  // 4. TURN CREDENTIALS (V24 Coturn Ephemeral Credentials)
  // ---------------------------------------------------------------------------
  if (action === 'turn') {
    const turnSecret = process.env.TURN_SECRET || 'auradrop-production-coturn-shared-secret-2026';
    const turnHost = process.env.TURN_HOST || 'turn.auradrop.network';
    const ttl = 86400;
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:${deviceId || 'device'}`;
    const hmac = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');

    res.statusCode = 200;
    res.end(JSON.stringify({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: [
            `turn:${turnHost}:3478?transport=udp`,
            `turn:${turnHost}:3478?transport=tcp`,
            `turns:${turnHost}:5349?transport=tcp`,
          ],
          username,
          credential: hmac,
        },
      ],
      ttl,
    }));
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
