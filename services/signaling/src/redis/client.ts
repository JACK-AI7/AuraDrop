import Redis from 'ioredis';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';

export interface DevicePresence {
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: string;
  visibility: 'everyone' | 'contacts' | 'off';
  localIp?: string;
  localPort?: number;
  instanceId: string;
  lastSeen: number;
}

export interface PairingCodePayload {
  code: string;
  initiatorDeviceId: string;
  initiatorName: string;
  platform?: string;
  createdAt: number;
}

export class RedisRealtimeService extends EventEmitter {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private isConnected = false;
  private subscribedChannels = new Set<string>();

  // In-memory fallback ONLY for single-process local dev if Redis is unreachable
  private memoryPresence = new Map<string, { data: DevicePresence; expiresAt: number }>();
  private memoryPairingCodes = new Map<string, { data: PairingCodePayload; expiresAt: number }>();

  constructor() {
    super();
    if (config.redisUrl) {
      try {
        this.pubClient = new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 300, 2000);
          },
        });

        this.subClient = new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 300, 2000);
          },
        });

        this.pubClient.on('connect', () => { this.isConnected = true; });
        this.pubClient.on('error', (err) => {
          this.isConnected = false;
          console.warn('[RedisRealtime] Client error:', err.message);
        });
        this.pubClient.on('close', () => { this.isConnected = false; });

        this.subClient.on('message', (channel, message) => {
          try {
            const data = JSON.parse(message);
            this.emit('message', channel, data);
          } catch {}
        });
      } catch (err: any) {
        console.warn('[RedisRealtime] Initialization warning:', err.message);
      }
    }
  }

  async initialize(): Promise<boolean> {
    if (!this.pubClient || !this.subClient) {
      console.warn('[RedisRealtime] No REDIS_URL configured. Redis presence and cross-instance clustering are degraded.');
      this.isConnected = false;
      return false;
    }

    try {
      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      this.isConnected = true;
      console.log(`[RedisRealtime] Successfully connected to Redis (${config.instanceId}).`);
      return true;
    } catch (err: any) {
      console.warn(`[RedisRealtime] Redis connection failed: ${err.message}. Running degraded.`);
      this.isConnected = false;
      return false;
    }
  }

  get isHealthy(): boolean {
    return this.isConnected;
  }

  async close(): Promise<void> {
    try {
      if (this.pubClient) await this.pubClient.quit();
      if (this.subClient) await this.subClient.quit();
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // PRESENCE WITH TTL (Section 3: heartbeat ~10s, TTL ~30s)
  // ---------------------------------------------------------------------------
  async setPresence(presence: DevicePresence, ttlSeconds = 30): Promise<void> {
    const key = `presence:${presence.deviceId}`;
    const payload = JSON.stringify(presence);

    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.setex(key, ttlSeconds, payload);
        return;
      } catch {}
    }

    // Local in-memory degraded fallback
    this.memoryPresence.set(presence.deviceId, {
      data: presence,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async getPresence(deviceId: string): Promise<DevicePresence | null> {
    const key = `presence:${deviceId}`;

    if (this.isConnected && this.pubClient) {
      try {
        const val = await this.pubClient.get(key);
        if (val) return JSON.parse(val);
        return null;
      } catch {}
    }

    const item = this.memoryPresence.get(deviceId);
    if (item && Date.now() <= item.expiresAt) {
      return item.data;
    }
    return null;
  }

  async removePresence(deviceId: string): Promise<void> {
    const key = `presence:${deviceId}`;

    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.del(key);
      } catch {}
    }

    this.memoryPresence.delete(deviceId);
  }

  async getMultiplePresence(deviceIds: string[]): Promise<Record<string, DevicePresence>> {
    const result: Record<string, DevicePresence> = {};
    if (deviceIds.length === 0) return result;

    if (this.isConnected && this.pubClient) {
      try {
        const keys = deviceIds.map((id) => `presence:${id}`);
        const values = await this.pubClient.mget(...keys);
        values.forEach((val, idx) => {
          if (val) {
            try {
              result[deviceIds[idx]] = JSON.parse(val);
            } catch {}
          }
        });
        return result;
      } catch {}
    }

    const now = Date.now();
    for (const id of deviceIds) {
      const item = this.memoryPresence.get(id);
      if (item && now <= item.expiresAt) {
        result[id] = item.data;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // TEMPORARY PAIRING CODES (Section 7: single-use, 120s TTL)
  // ---------------------------------------------------------------------------
  async createPairingCode(payload: PairingCodePayload, ttlSeconds = 120): Promise<void> {
    const key = `pair_code:${payload.code}`;
    const serialized = JSON.stringify(payload);

    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.setex(key, ttlSeconds, serialized);
        return;
      } catch {}
    }

    this.memoryPairingCodes.set(payload.code, {
      data: payload,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async consumePairingCode(code: string): Promise<PairingCodePayload | null> {
    const key = `pair_code:${code}`;

    if (this.isConnected && this.pubClient) {
      try {
        const val = await this.pubClient.get(key);
        if (val) {
          await this.pubClient.del(key); // Single-use consumption
          return JSON.parse(val);
        }
        return null;
      } catch {}
    }

    const item = this.memoryPairingCodes.get(code);
    if (item && Date.now() <= item.expiresAt) {
      this.memoryPairingCodes.delete(code);
      return item.data;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // CROSS-INSTANCE PUB/SUB (Section 5: Chrome on A <-> Android on B)
  // ---------------------------------------------------------------------------
  async publishToDevice(targetDeviceId: string, message: any): Promise<void> {
    const channel = `auradrop:msg:${targetDeviceId}`;
    const payload = JSON.stringify(message);

    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.publish(channel, payload);
        return;
      } catch {}
    }

    // Local emit if Redis is unavailable
    this.emit('message', channel, message);
  }

  async subscribeDevice(deviceId: string): Promise<void> {
    const channel = `auradrop:msg:${deviceId}`;
    this.subscribedChannels.add(channel);

    if (this.isConnected && this.subClient) {
      try {
        await this.subClient.subscribe(channel);
      } catch {}
    }
  }

  async unsubscribeDevice(deviceId: string): Promise<void> {
    const channel = `auradrop:msg:${deviceId}`;
    this.subscribedChannels.delete(channel);

    if (this.isConnected && this.subClient) {
      try {
        await this.subClient.unsubscribe(channel);
      } catch {}
    }
  }
}
