import { Router } from 'express';
import { NeonDatabaseService } from '../db/neon.js';
import { RedisRealtimeService } from '../redis/client.js';
import { generateTurnCredentials } from '../turn/credentials.js';
import {
  PairCreateRequestSchema,
  PairJoinRequestSchema,
  TurnCredentialsRequestSchema,
} from '../schemas.js';

export function createApiRouter(db: NeonDatabaseService, redis: RedisRealtimeService): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // 1. HEALTHZ & VERSION (Section 4)
  // ---------------------------------------------------------------------------
  router.get('/healthz', (req, res) => {
    const isDb = db.isHealthy;
    const isRedis = redis.isHealthy;
    const status = isDb && isRedis ? 'ok' : 'degraded';

    res.status(isDb ? 200 : 503).json({
      status,
      database: isDb,
      redis: isRedis,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });

  router.get('/version', (req, res) => {
    res.json({
      service: 'AuraDrop Standalone Signaling Service',
      version: '25.0.0',
      protocol: 'P2PFS/1',
      webrtc: true,
      turn: true,
      durableDb: 'Neon PostgreSQL',
      realtimeBackplane: 'Redis Pub/Sub',
    });
  });

  // ---------------------------------------------------------------------------
  // 2. TRUSTED DEVICES (Section 0 / 4)
  // ---------------------------------------------------------------------------
  router.get('/devices/trusted', async (req, res) => {
    const deviceId = req.query.deviceId?.toString();
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId query parameter is required' });
      return;
    }

    const peerIds = await db.getTrustedPeerIds(deviceId);
    const presenceMap = await redis.getMultiplePresence(peerIds);

    const devices = await Promise.all(
      peerIds.map(async (pid) => {
        const presence = presenceMap[pid];
        const dbDev = await db.getDevice(pid);
        return {
          id: pid,
          deviceId: pid,
          displayName: presence?.displayName || dbDev?.display_name || 'Trusted Device',
          deviceName: presence?.deviceName || dbDev?.device_name || 'Trusted Device',
          platform: presence?.platform || dbDev?.platform || 'web',
          isOnline: Boolean(presence),
          isTrusted: true,
          connectionState: presence ? 'ONLINE' : 'OFFLINE',
          localIp: presence?.localIp,
          localPort: presence?.localPort,
        };
      })
    );

    res.json({ deviceId, trustedDevices: devices });
  });

  // ---------------------------------------------------------------------------
  // 3. PROFILES
  // ---------------------------------------------------------------------------
  router.get('/profile/:deviceId', async (req, res) => {
    const device = await db.getDevice(req.params.deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    res.json(device);
  });

  // ---------------------------------------------------------------------------
  // 4. FIRST-TIME PAIRING (Section 7: QR / Short 6-digit code, 120s TTL)
  // ---------------------------------------------------------------------------
  router.post('/pair/create', async (req, res) => {
    const parsed = PairCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid pair request', details: parsed.error.format() });
      return;
    }

    // Generate random secure 6-digit pairing code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await redis.createPairingCode({
      code,
      initiatorDeviceId: parsed.data.initiatorDeviceId,
      initiatorName: parsed.data.initiatorName,
      platform: parsed.data.platform,
      createdAt: Date.now(),
    }, 120);

    res.json({
      code,
      initiatorDeviceId: parsed.data.initiatorDeviceId,
      expiresInSeconds: 120,
    });
  });

  router.post('/pair/join', async (req, res) => {
    const parsed = PairJoinRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid join request', details: parsed.error.format() });
      return;
    }

    const { joinerDeviceId, joinerName, pairingCode } = parsed.data;

    // Atomically consume single-use code from Redis
    const payload = await redis.consumePairingCode(pairingCode);
    if (!payload) {
      res.status(404).json({ error: 'Invalid or expired pairing code' });
      return;
    }

    if (payload.initiatorDeviceId === joinerDeviceId) {
      res.status(400).json({ error: 'Cannot pair device with itself' });
      return;
    }

    // Persist bilateral trust to Neon PostgreSQL
    const pair = await db.createTrustedPair(payload.initiatorDeviceId, joinerDeviceId);

    // Notify the initiator via Redis Pub/Sub
    const pairConfirmedMsg = {
      type: 'PAIR_CONFIRMED',
      pairId: pair?.pair_id,
      pairedWith: joinerDeviceId,
      peerName: joinerName,
      timestamp: Date.now(),
    };
    await redis.publishToDevice(payload.initiatorDeviceId, pairConfirmedMsg);

    res.json({
      success: true,
      pairId: pair?.pair_id,
      pairedWith: payload.initiatorDeviceId,
      initiatorName: payload.initiatorName,
    });
  });

  // ---------------------------------------------------------------------------
  // 5. TURN CREDENTIALS (Section 11)
  // ---------------------------------------------------------------------------
  router.all('/turn/credentials', (req, res) => {
    const deviceId = (req.body?.deviceId || req.query.deviceId || 'device').toString();
    const creds = generateTurnCredentials(deviceId);
    res.json(creds);
  });

  // ---------------------------------------------------------------------------
  // 6. LEGACY COMPATIBILITY ROUTER (/api/signaling)
  // ---------------------------------------------------------------------------
  router.all('/api/signaling', async (req, res) => {
    const action = req.query.action || req.body?.action || 'poll';
    const deviceId = (req.query.deviceId || req.body?.deviceId || req.body?.senderId)?.toString();

    if (action === 'turn') {
      const creds = generateTurnCredentials(deviceId || 'guest');
      res.json(creds);
      return;
    }

    if (action === 'pair') {
      const initiatorId = (req.body?.initiatorDeviceId || req.body?.deviceId || deviceId)?.toString();
      const targetId = req.body?.targetDeviceId?.toString();
      if (initiatorId && targetId) {
        const pair = await db.createTrustedPair(initiatorId, targetId);
        const pairNotif = {
          type: 'PAIR_CONFIRMED',
          pairId: pair?.pair_id,
          pairedWith: initiatorId,
          timestamp: Date.now(),
        };
        await redis.publishToDevice(targetId, pairNotif);
        res.json({ success: true, pairId: pair?.pair_id, paired: true });
        return;
      }
      res.status(400).json({ error: 'deviceId and targetDeviceId required' });
      return;
    }

    if (action === 'register' || action === 'poll') {
      if (deviceId) {
        const name = req.body?.displayName || req.body?.name || req.query.name?.toString() || 'AuraDrop Client';
        const platform = req.body?.platform || req.query.platform?.toString() || 'web';

        await db.upsertDevice({
          deviceId,
          displayName: name,
          deviceName: req.body?.deviceName || name,
          platform,
        });

        // Parse trusted peers from query/body
        const trustedParam = req.query.trustedPeers?.toString() || '';
        const bodyPeers = Array.isArray(req.body?.trustedPeers) ? req.body.trustedPeers : [];
        const trustedList = [...bodyPeers, ...(trustedParam ? trustedParam.split(',') : [])].filter(Boolean);

        for (const tId of trustedList) {
          if (tId !== deviceId) {
            await db.createTrustedPair(deviceId, tId);
          }
        }

        // Set live presence
        await redis.setPresence({
          deviceId,
          displayName: name,
          deviceName: req.body?.deviceName || name,
          platform,
          visibility: 'everyone',
          localIp: req.body?.localIp || req.query.localIp?.toString(),
          localPort: req.body?.localPort || (req.query.localPort ? Number(req.query.localPort) : undefined),
          instanceId: deviceId,
          lastSeen: Date.now(),
        }, 30);

        // Fetch trusted peers and their live presence
        const peerIds = await db.getTrustedPeerIds(deviceId);
        const presenceMap = await redis.getMultiplePresence(peerIds);

        const peers = peerIds.map((pid) => {
          const pres = presenceMap[pid];
          return {
            id: pid,
            deviceId: pid,
            displayName: pres?.displayName || 'Trusted Device',
            name: pres?.displayName || 'Trusted Device',
            deviceName: pres?.deviceName || 'Trusted Device',
            platform: pres?.platform || 'web',
            isOnline: Boolean(pres),
            isTrusted: true,
            connectionState: pres ? 'READY_TO_TRANSFER' : 'OFFLINE',
            localIp: pres?.localIp,
            localPort: pres?.localPort,
          };
        });

        res.json({
          success: true,
          deviceId,
          peers,
          messages: [],
        });
        return;
      }
    }

    res.json({ status: 'ok' });
  });

  return router;
}
