import pg from 'pg';
import { config } from '../config.js';

export interface DeviceRecord {
  id: string;
  user_id?: string | null;
  display_name: string;
  device_name: string;
  platform: string;
  device_type?: string;
  app_version?: string;
  avatar_url?: string;
  status: string;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
  revoked_at?: Date | null;
}

export interface TrustedPairRecord {
  pair_id: string;
  device_a_id: string;
  device_b_id: string;
  created_at: Date;
  updated_at: Date;
  revoked_at?: Date | null;
}

export class NeonDatabaseService {
  private pool: pg.Pool;
  private isConnected = false;

  constructor() {
    this.pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      console.warn('[NeonDB] Unexpected pool error:', err.message);
    });
  }

  async initialize(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        this.isConnected = true;
        console.log('[NeonDB] Successfully connected to live Neon PostgreSQL cluster.');
        return true;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn(`[NeonDB] Connection failed: ${err.message}. Database features degraded.`);
      this.isConnected = false;
      return false;
    }
  }

  get isHealthy(): boolean {
    return this.isConnected;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---------------------------------------------------------------------------
  // DEVICES
  // ---------------------------------------------------------------------------
  async upsertDevice(data: {
    deviceId: string;
    displayName: string;
    deviceName: string;
    platform: string;
    deviceType?: string;
    appVersion?: string;
    avatarUrl?: string;
  }): Promise<DeviceRecord | null> {
    const query = `
      INSERT INTO devices (
        id, display_name, device_name, platform, device_type, app_version, avatar_url,
        status, last_seen_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        device_name = EXCLUDED.device_name,
        platform = EXCLUDED.platform,
        device_type = COALESCE(EXCLUDED.device_type, devices.device_type),
        app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
        avatar_url = COALESCE(EXCLUDED.avatar_url, devices.avatar_url),
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *;
    `;
    try {
      const res = await this.pool.query(query, [
        data.deviceId,
        data.displayName,
        data.deviceName,
        data.platform,
        data.deviceType || (data.platform === 'android' ? 'mobile' : 'desktop'),
        data.appVersion || '25.0.0',
        data.avatarUrl || null,
      ]);
      return res.rows[0] as DeviceRecord;
    } catch (err: any) {
      console.warn('[NeonDB] upsertDevice notice:', err.message);
      return null;
    }
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    try {
      const res = await this.pool.query('SELECT * FROM devices WHERE id = $1 AND revoked_at IS NULL;', [deviceId]);
      return res.rows[0] || null;
    } catch (err: any) {
      console.warn('[NeonDB] getDevice notice:', err.message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // TRUSTED PAIRS (Bilateral Authorization)
  // ---------------------------------------------------------------------------
  async createTrustedPair(deviceAId: string, deviceBId: string): Promise<TrustedPairRecord | null> {
    const pairId = `pair_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    // Normalize order so (A, B) and (B, A) are canonical
    const [d1, d2] = [deviceAId, deviceBId].sort();

    const query = `
      INSERT INTO trusted_device_pairs (pair_id, device_a_id, device_b_id, created_at, updated_at, revoked_at)
      VALUES ($1, $2, $3, NOW(), NOW(), NULL)
      ON CONFLICT (device_a_id, device_b_id) DO UPDATE SET
        revoked_at = NULL,
        updated_at = NOW()
      RETURNING *;
    `;
    try {
      // Ensure both devices exist in devices table first
      await this.upsertDevice({
        deviceId: d1,
        displayName: 'AuraDrop Client',
        deviceName: 'AuraDrop Client',
        platform: 'web',
      });
      await this.upsertDevice({
        deviceId: d2,
        displayName: 'AuraDrop Peer',
        deviceName: 'AuraDrop Peer',
        platform: 'android',
      });

      const res = await this.pool.query(query, [pairId, d1, d2]);
      return res.rows[0] as TrustedPairRecord;
    } catch (err: any) {
      console.warn('[NeonDB] createTrustedPair notice:', err.message);
      return null;
    }
  }

  async getTrustedPeerIds(deviceId: string): Promise<string[]> {
    const query = `
      SELECT 
        CASE WHEN device_a_id = $1 THEN device_b_id ELSE device_a_id END AS peer_id
      FROM trusted_device_pairs
      WHERE (device_a_id = $1 OR device_b_id = $1)
        AND revoked_at IS NULL;
    `;
    try {
      const res = await this.pool.query(query, [deviceId]);
      return res.rows.map((r: any) => r.peer_id);
    } catch (err: any) {
      console.warn('[NeonDB] getTrustedPeerIds notice:', err.message);
      return [];
    }
  }

  async areDevicesTrusted(deviceA: string, deviceB: string): Promise<boolean> {
    const [d1, d2] = [deviceA, deviceB].sort();
    const query = `
      SELECT 1 FROM trusted_device_pairs
      WHERE device_a_id = $1 AND device_b_id = $2 AND revoked_at IS NULL
      LIMIT 1;
    `;
    try {
      const res = await this.pool.query(query, [d1, d2]);
      return res.rowCount !== null && res.rowCount > 0;
    } catch (err: any) {
      console.warn('[NeonDB] areDevicesTrusted notice:', err.message);
      return false;
    }
  }

  async revokeTrustedPair(deviceA: string, deviceB: string): Promise<boolean> {
    const [d1, d2] = [deviceA, deviceB].sort();
    const query = `
      UPDATE trusted_device_pairs
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE device_a_id = $1 AND device_b_id = $2;
    `;
    try {
      await this.pool.query(query, [d1, d2]);
      return true;
    } catch (err: any) {
      console.warn('[NeonDB] revokeTrustedPair notice:', err.message);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // CHAT PERSISTENCE
  // ---------------------------------------------------------------------------
  async saveMessage(data: {
    id: string;
    conversationId: string;
    senderId: string;
    text: string;
    type?: string;
    replyToId?: string;
    expiresAt?: Date | null;
  }): Promise<boolean> {
    const query = `
      INSERT INTO messages (
        id, conversation_id, sender_id, text, type, reply_to_id, expires_at, is_deleted_everyone, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW())
      ON CONFLICT (id) DO NOTHING;
    `;
    try {
      await this.pool.query(query, [
        data.id,
        data.conversationId,
        data.senderId,
        data.text,
        data.type || 'text',
        data.replyToId || null,
        data.expiresAt || null,
      ]);
      return true;
    } catch (err: any) {
      console.warn('[NeonDB] saveMessage notice:', err.message);
      return false;
    }
  }

  async getMessages(conversationId: string, limit = 50): Promise<any[]> {
    const query = `
      SELECT * FROM messages
      WHERE conversation_id = $1 
        AND is_deleted_everyone = false
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    try {
      const res = await this.pool.query(query, [conversationId, limit]);
      return res.rows.reverse();
    } catch (err: any) {
      console.warn('[NeonDB] getMessages notice:', err.message);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // AUDIT EVENTS
  // ---------------------------------------------------------------------------
  async recordAuditEvent(data: {
    eventType: string;
    deviceId?: string;
    severity?: string;
    ipAddress?: string;
    metadata?: any;
  }): Promise<void> {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const query = `
      INSERT INTO audit_events (id, device_id, event_type, severity, ip_address, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT DO NOTHING;
    `;
    try {
      await this.pool.query(query, [
        id,
        data.deviceId || null,
        data.eventType,
        data.severity || 'INFO',
        data.ipAddress || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]);
    } catch {}
  }
}
