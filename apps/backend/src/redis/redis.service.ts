import Redis from 'ioredis';
import { EventEmitter } from 'node:events';

export interface PresencePayload {
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: string;
  visibility: 'everyone' | 'trusted' | 'off';
  capabilities?: {
    webrtc: boolean;
    directLan: boolean;
  };
  remoteIp?: string;
  instanceId: string;
  lastSeen: number;
}

export class RedisRealtimeService {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private isConnected = false;
  private instanceId = `inst_${process.pid}_${Math.random().toString(36).substring(2, 7)}`;

  // In-memory fallback
  private memPresence = new Map<string, { data: PresencePayload; expiresAt: number }>();
  private localBus = new EventEmitter();
  private rateLimitCounters = new Map<string, { count: number; expiresAt: number }>();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    if (url) {
      try {
        this.pubClient = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => {
            if (times > 3) return null; // Stop retrying after 3 attempts
            return Math.min(times * 200, 1000);
          },
        });

        this.subClient = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 200, 1000);
          },
        });
      } catch (err) {
        console.warn('[RedisRealtimeService] Redis client initialization warning:', err);
      }
    }

    // Periodic sweep for in-memory presence expiration
    setInterval(() => {
      const now = Date.now();
      for (const [id, item] of this.memPresence.entries()) {
        if (now > item.expiresAt) {
          this.memPresence.delete(id);
        }
      }
      for (const [key, item] of this.rateLimitCounters.entries()) {
        if (now > item.expiresAt) {
          this.rateLimitCounters.delete(key);
        }
      }
    }, 5000).unref();
  }

  async initialize(): Promise<void> {
    if (!this.pubClient || !this.subClient) {
      console.log(`[RedisRealtimeService] No REDIS_URL configured. Running with in-memory distributed fallback (${this.instanceId}).`);
      return;
    }

    try {
      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      this.isConnected = true;
      console.log(`[RedisRealtimeService] Connected to Redis cluster (${this.instanceId}).`);
    } catch (err: any) {
      console.warn(`[RedisRealtimeService] Redis connection failed: ${err.message}. Using in-memory fallback.`);
      this.isConnected = false;
    }
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  // ==========================================
  // DISTRIBUTED PRESENCE (Section 10)
  // ==========================================
  async setPresence(payload: PresencePayload, ttlSeconds = 15): Promise<void> {
    const key = `presence:${payload.deviceId}`;
    payload.instanceId = this.instanceId;
    payload.lastSeen = Date.now();

    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.setex(key, ttlSeconds, JSON.stringify(payload));
        return;
      } catch (err) {
        console.warn('[RedisRealtimeService] Redis setex failed, falling back to memory:', err);
      }
    }

    this.memPresence.set(payload.deviceId, {
      data: payload,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async refreshPresence(deviceId: string, ttlSeconds = 15): Promise<void> {
    const key = `presence:${deviceId}`;
    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.expire(key, ttlSeconds);
        return;
      } catch (err) {
        // Fallback
      }
    }

    const item = this.memPresence.get(deviceId);
    if (item) {
      item.data.lastSeen = Date.now();
      item.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }

  async removePresence(deviceId: string): Promise<void> {
    const key = `presence:${deviceId}`;
    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.del(key);
        return;
      } catch (err) {
        // Fallback
      }
    }

    this.memPresence.delete(deviceId);
  }

  async getPresence(deviceId: string): Promise<PresencePayload | null> {
    const key = `presence:${deviceId}`;
    if (this.isConnected && this.pubClient) {
      try {
        const raw = await this.pubClient.get(key);
        if (raw) return JSON.parse(raw);
        return null;
      } catch (err) {
        // Fallback
      }
    }

    const item = this.memPresence.get(deviceId);
    if (item && Date.now() <= item.expiresAt) {
      return item.data;
    }
    return null;
  }

  async getActivePeers(excludeDeviceId?: string): Promise<PresencePayload[]> {
    if (this.isConnected && this.pubClient) {
      try {
        const keys = await this.pubClient.keys('presence:*');
        if (keys.length === 0) return [];
        const records = await this.pubClient.mget(...keys);
        const peers: PresencePayload[] = [];
        for (const raw of records) {
          if (raw) {
            try {
              const p: PresencePayload = JSON.parse(raw);
              if (p.deviceId !== excludeDeviceId && p.visibility !== 'off') {
                peers.push(p);
              }
            } catch {
              // Ignore corrupt
            }
          }
        }
        return peers;
      } catch (err) {
        // Fallback
      }
    }

    const now = Date.now();
    const peers: PresencePayload[] = [];
    for (const [id, item] of this.memPresence.entries()) {
      if (id !== excludeDeviceId && now <= item.expiresAt && item.data.visibility !== 'off') {
        peers.push(item.data);
      }
    }
    return peers;
  }

  // ==========================================
  // DISTRIBUTED SIGNALING PUB/SUB RELAY (Section 10 & 11)
  // ==========================================
  async publishSignaling(channel: string, message: any): Promise<void> {
    const enriched = {
      ...message,
      _originInstance: this.instanceId,
    };
    const json = JSON.stringify(enriched);

    if (this.isConnected && this.pubClient) {
      try {
        await this.pubClient.publish(channel, json);
        return;
      } catch (err) {
        console.warn('[RedisRealtimeService] Redis publish failed, falling back to local bus:', err);
      }
    }

    this.localBus.emit(channel, enriched);
  }

  async subscribeSignaling(channel: string, onMessage: (message: any) => void): Promise<void> {
    if (this.isConnected && this.subClient) {
      try {
        await this.subClient.subscribe(channel);
        this.subClient.on('message', (chan, raw) => {
          if (chan === channel) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed._originInstance !== this.instanceId) {
                onMessage(parsed);
              }
            } catch {
              // Ignore
            }
          }
        });
        return;
      } catch (err) {
        console.warn('[RedisRealtimeService] Redis subscribe failed, falling back to local bus:', err);
      }
    }

    this.localBus.on(channel, (data) => {
      if (data._originInstance !== this.instanceId) {
        onMessage(data);
      }
    });
  }

  // ==========================================
  // SLIDING-WINDOW RATE LIMITER (Section 10 & 20)
  // ==========================================
  async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
    const rateKey = `ratelimit:${key}`;
    if (this.isConnected && this.pubClient) {
      try {
        const current = await this.pubClient.incr(rateKey);
        if (current === 1) {
          await this.pubClient.expire(rateKey, windowSeconds);
        }
        return {
          allowed: current <= limit,
          remaining: Math.max(0, limit - current),
        };
      } catch {
        // Fallback
      }
    }

    const now = Date.now();
    const entry = this.rateLimitCounters.get(rateKey);
    if (!entry || now > entry.expiresAt) {
      this.rateLimitCounters.set(rateKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1 };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
    };
  }

  async close(): Promise<void> {
    if (this.pubClient) {
      await this.pubClient.quit().catch(() => {});
    }
    if (this.subClient) {
      await this.subClient.quit().catch(() => {});
    }
    this.isConnected = false;
  }
}
