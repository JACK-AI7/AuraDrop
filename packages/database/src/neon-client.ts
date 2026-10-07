import { Pool, PoolConfig } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import dns from 'node:dns';

// Ensure IPv4 lookup priority across Node.js environments where IPv6 WAN is unreachable
try {
  const origLookup = dns.lookup;
  // @ts-ignore
  dns.lookup = (hostname: string, options: any, callback: any) => {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    }
    return origLookup(hostname, { ...opts, family: 4 }, (err, address, family) => {
      if (err) return cb(err);
      if (opts && opts.all) {
        if (Array.isArray(address)) {
          return cb(null, address.filter((a: any) => a.family === 4));
        }
        return cb(null, [{ address, family: 4 }]);
      }
      return cb(null, address, family);
    });
  };
} catch {
  // Ignore
}

export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  email_verified_at?: Date | null;
  display_name: string;
  username: string;
  avatar_url?: string | null;
  bio?: string;
  country_code?: string;
  language?: string;
  timezone?: string;
  status: 'active' | 'suspended' | 'deleted';
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date | null;
}

export interface UserPreferencesRow {
  user_id: string;
  theme: string;
  language: string;
  auto_accept: boolean;
  default_visibility: string;
  notifications_enabled: boolean;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  download_directory_preference?: string | null;
  allow_background_transfers: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DeviceRow {
  id: string;
  user_id?: string | null;
  device_public_key: string;
  device_name: string;
  platform: string;
  platform_version?: string | null;
  app_version: string;
  protocol_version: string;
  device_model?: string | null;
  capabilities_json: any;
  status: 'active' | 'revoked' | 'inactive';
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TransferSessionRow {
  id: string;
  sender_user_id?: string | null;
  sender_device_id: string;
  receiver_user_id?: string | null;
  receiver_device_id: string;
  status: string;
  direction: string;
  file_count: number;
  total_bytes: string | number;
  transferred_bytes: string | number;
  created_at: Date;
  accepted_at?: Date | null;
  started_at?: Date | null;
  completed_at?: Date | null;
  failed_at?: Date | null;
  failure_code?: string | null;
}

export interface TransferFileRow {
  id: string;
  transfer_session_id: string;
  file_name: string;
  mime_type: string;
  file_size: string | number;
  sha256: string;
  verified_offset: string | number;
  transferred_bytes: string | number;
  status: string;
  created_at: Date;
  completed_at?: Date | null;
}

export interface RefreshSessionRow {
  id: string;
  user_id: string;
  device_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  revoked_at?: Date | null;
  last_used_at: Date;
}

export class NeonDatabaseClient {
  private pool: Pool | null = null;
  public isConnectedToDb = false;

  // In-memory fallback stores
  private memUsers = new Map<string, UserRow>();
  private memPreferences = new Map<string, UserPreferencesRow>();
  private memDevices = new Map<string, DeviceRow>();
  private memSessions = new Map<string, any>();
  private memTrusted = new Map<string, any>();
  private memContacts = new Map<string, any>();
  private memVisibility = new Map<string, string>();
  private memTransfers = new Map<string, TransferSessionRow>();
  private memTransferFiles = new Map<string, TransferFileRow>();
  private memTransferEvents = new Map<string, any>();
  private memRefreshSessions = new Map<string, RefreshSessionRow>();
  private memSecurityEvents = new Map<string, any>();

  constructor(connectionString?: string) {
    this.tryLoadEnv();
    const connStr = connectionString || process.env.DATABASE_URL;
    if (connStr) {
      try {
        const poolConfig: PoolConfig = {
          connectionString: connStr,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        };

        if (connStr.includes('neon') || connStr.includes('sslmode=require') || !connStr.includes('localhost')) {
          poolConfig.ssl = { rejectUnauthorized: false };
        }

        this.pool = new Pool(poolConfig);
      } catch (err) {
        console.warn('[NeonDatabaseClient] Warning initializing pool:', err);
      }
    }
  }

  private tryLoadEnv(): void {
    if (process.env.DATABASE_URL) return;
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), 'apps/backend/.env'),
      path.resolve(__dirname, '../../../.env'),
      path.resolve(__dirname, '../../../apps/backend/.env'),
      path.resolve(__dirname, '../../.env'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              const eq = trimmed.indexOf('=');
              if (eq > 0) {
                const k = trimmed.slice(0, eq).trim();
                let v = trimmed.slice(eq + 1).trim();
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                  v = v.slice(1, -1);
                }
                if (!process.env[k]) {
                  process.env[k] = v;
                }
              }
            }
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  async initialize(): Promise<void> {
    if (!this.pool) {
      console.log('[NeonDatabaseClient] No DATABASE_URL provided. Running in high-performance memory store mode.');
      return;
    }

    try {
      const client = await this.pool.connect();
      this.isConnectedToDb = true;
      console.log('[NeonDatabaseClient] Connected to Neon PostgreSQL database.');

      // Check or run migrations
      try {
        const migrationPaths = [
          path.resolve(__dirname, '../migrations/001_initial_schema.sql'),
          path.resolve(__dirname, '../../packages/database/migrations/001_initial_schema.sql'),
          path.resolve(process.cwd(), 'packages/database/migrations/001_initial_schema.sql'),
        ];
        let sql = '';
        for (const mp of migrationPaths) {
          if (fs.existsSync(mp)) {
            sql = fs.readFileSync(mp, 'utf8');
            break;
          }
        }

        if (sql) {
          await client.query(sql);
          console.log('[NeonDatabaseClient] Executed migration 001_initial_schema.sql successfully.');
        }
      } catch (mErr) {
        console.warn('[NeonDatabaseClient] Migration notice (tables may already exist):', mErr);
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn(`[NeonDatabaseClient] PostgreSQL connection failed: ${err.message}. Falling back to in-memory store.`);
      this.isConnectedToDb = false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnectedToDb = false;
    }
  }

  // ==========================================
  // USERS REPOSITORY
  // ==========================================
  readonly users = {
    create: async (user: {
      id: string;
      email: string;
      passwordHash: string;
      displayName: string;
      username: string;
      avatarUrl?: string;
    }): Promise<UserRow> => {
      const emailNormalized = user.email.trim().toLowerCase();
      const now = new Date();
      const row: UserRow = {
        id: user.id,
        email: user.email,
        email_normalized: emailNormalized,
        password_hash: user.passwordHash,
        display_name: user.displayName,
        username: user.username.trim().toLowerCase(),
        avatar_url: user.avatarUrl || null,
        status: 'active',
        created_at: now,
        updated_at: now,
      };

      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO users (id, email, email_normalized, password_hash, display_name, username, avatar_url, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *;
        `;
        const res = await this.pool.query(q, [
          row.id,
          row.email,
          row.email_normalized,
          row.password_hash,
          row.display_name,
          row.username,
          row.avatar_url,
          row.status,
          row.created_at,
          row.updated_at,
        ]);
        return res.rows[0];
      }

      this.memUsers.set(row.id, row);
      return row;
    },

    findById: async (id: string): Promise<UserRow | null> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1;', [id]);
        return res.rows[0] || null;
      }
      return this.memUsers.get(id) || null;
    },

    findByEmail: async (email: string): Promise<UserRow | null> => {
      const norm = email.trim().toLowerCase();
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM users WHERE email_normalized = $1 AND deleted_at IS NULL LIMIT 1;', [norm]);
        return res.rows[0] || null;
      }
      for (const u of this.memUsers.values()) {
        if (u.email_normalized === norm) return u;
      }
      return null;
    },

    findByUsername: async (username: string): Promise<UserRow | null> => {
      const norm = username.trim().toLowerCase();
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1;', [norm]);
        return res.rows[0] || null;
      }
      for (const u of this.memUsers.values()) {
        if (u.username === norm) return u;
      }
      return null;
    },

    updateLastLogin: async (id: string): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2;', [now, id]);
        return;
      }
      const u = this.memUsers.get(id);
      if (u) {
        u.last_login_at = now;
        u.updated_at = now;
      }
    },
  };

  // ==========================================
  // PREFERENCES REPOSITORY
  // ==========================================
  readonly preferences = {
    upsert: async (userId: string, prefs: Partial<UserPreferencesRow>): Promise<UserPreferencesRow> => {
      const now = new Date();
      const defaultPrefs: UserPreferencesRow = {
        user_id: userId,
        theme: prefs.theme || 'dark',
        language: prefs.language || 'en',
        auto_accept: prefs.auto_accept ?? false,
        default_visibility: prefs.default_visibility || 'EVERYONE',
        notifications_enabled: prefs.notifications_enabled ?? true,
        sound_enabled: prefs.sound_enabled ?? true,
        vibration_enabled: prefs.vibration_enabled ?? true,
        download_directory_preference: prefs.download_directory_preference || null,
        allow_background_transfers: prefs.allow_background_transfers ?? true,
        created_at: now,
        updated_at: now,
      };

      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO user_preferences (user_id, theme, language, auto_accept, default_visibility, notifications_enabled, sound_enabled, vibration_enabled, download_directory_preference, allow_background_transfers, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (user_id) DO UPDATE SET
            theme = EXCLUDED.theme,
            language = EXCLUDED.language,
            auto_accept = EXCLUDED.auto_accept,
            default_visibility = EXCLUDED.default_visibility,
            notifications_enabled = EXCLUDED.notifications_enabled,
            sound_enabled = EXCLUDED.sound_enabled,
            vibration_enabled = EXCLUDED.vibration_enabled,
            download_directory_preference = EXCLUDED.download_directory_preference,
            allow_background_transfers = EXCLUDED.allow_background_transfers,
            updated_at = EXCLUDED.updated_at
          RETURNING *;
        `;
        const res = await this.pool.query(q, [
          defaultPrefs.user_id,
          defaultPrefs.theme,
          defaultPrefs.language,
          defaultPrefs.auto_accept,
          defaultPrefs.default_visibility,
          defaultPrefs.notifications_enabled,
          defaultPrefs.sound_enabled,
          defaultPrefs.vibration_enabled,
          defaultPrefs.download_directory_preference,
          defaultPrefs.allow_background_transfers,
          defaultPrefs.created_at,
          defaultPrefs.updated_at,
        ]);
        return res.rows[0];
      }

      const existing = this.memPreferences.get(userId);
      const updated = { ...(existing || defaultPrefs), ...prefs, updated_at: now };
      this.memPreferences.set(userId, updated);
      return updated;
    },

    findByUserId: async (userId: string): Promise<UserPreferencesRow | null> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM user_preferences WHERE user_id = $1 LIMIT 1;', [userId]);
        return res.rows[0] || null;
      }
      return this.memPreferences.get(userId) || null;
    },
  };

  // ==========================================
  // DEVICES REPOSITORY
  // ==========================================
  readonly devices = {
    register: async (device: {
      id: string;
      userId?: string | null;
      devicePublicKey: string;
      deviceName: string;
      platform: string;
      platformVersion?: string;
      appVersion?: string;
      protocolVersion?: string;
      deviceModel?: string;
      capabilitiesJson?: any;
    }): Promise<DeviceRow> => {
      const now = new Date();
      const row: DeviceRow = {
        id: device.id,
        user_id: device.userId || null,
        device_public_key: device.devicePublicKey,
        device_name: device.deviceName,
        platform: device.platform,
        platform_version: device.platformVersion || null,
        app_version: device.appVersion || '16.0.0',
        protocol_version: device.protocolVersion || 'P2PFS/1',
        device_model: device.deviceModel || null,
        capabilities_json: device.capabilitiesJson || {},
        status: 'active',
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      };

      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO devices (id, user_id, device_public_key, device_name, platform, platform_version, app_version, protocol_version, device_model, capabilities_json, status, last_seen_at, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            device_name = EXCLUDED.device_name,
            platform = EXCLUDED.platform,
            last_seen_at = EXCLUDED.last_seen_at,
            updated_at = EXCLUDED.updated_at
          RETURNING *;
        `;
        const res = await this.pool.query(q, [
          row.id,
          row.user_id,
          row.device_public_key,
          row.device_name,
          row.platform,
          row.platform_version,
          row.app_version,
          row.protocol_version,
          row.device_model,
          JSON.stringify(row.capabilities_json),
          row.status,
          row.last_seen_at,
          row.created_at,
          row.updated_at,
        ]);
        return res.rows[0];
      }

      this.memDevices.set(row.id, row);
      return row;
    },

    findById: async (id: string): Promise<DeviceRow | null> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM devices WHERE id = $1 LIMIT 1;', [id]);
        return res.rows[0] || null;
      }
      return this.memDevices.get(id) || null;
    },

    findByUserId: async (userId: string): Promise<DeviceRow[]> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM devices WHERE user_id = $1 AND status != \'revoked\';', [userId]);
        return res.rows;
      }
      return Array.from(this.memDevices.values()).filter((d) => d.user_id === userId && d.status !== 'revoked');
    },

    updateLastSeen: async (id: string): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE devices SET last_seen_at = $1 WHERE id = $2;', [now, id]);
        return;
      }
      const d = this.memDevices.get(id);
      if (d) d.last_seen_at = now;
    },

    revoke: async (id: string): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE devices SET status = \'revoked\', revoked_at = $1, updated_at = $1 WHERE id = $2;', [now, id]);
        return;
      }
      const d = this.memDevices.get(id);
      if (d) d.status = 'revoked';
    },
  };

  // ==========================================
  // REFRESH SESSIONS REPOSITORY (JWT Rotation)
  // ==========================================
  readonly refreshSessions = {
    create: async (session: {
      id: string;
      userId: string;
      deviceId: string;
      tokenHash: string;
      expiresAt: Date;
    }): Promise<RefreshSessionRow> => {
      const now = new Date();
      const row: RefreshSessionRow = {
        id: session.id,
        user_id: session.userId,
        device_id: session.deviceId,
        token_hash: session.tokenHash,
        expires_at: session.expiresAt,
        created_at: now,
        last_used_at: now,
      };

      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO refresh_sessions (id, user_id, device_id, token_hash, expires_at, created_at, last_used_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *;
        `;
        const res = await this.pool.query(q, [row.id, row.user_id, row.device_id, row.token_hash, row.expires_at, row.created_at, row.last_used_at]);
        return res.rows[0];
      }

      this.memRefreshSessions.set(session.tokenHash, row);
      return row;
    },

    findByTokenHash: async (tokenHash: string): Promise<RefreshSessionRow | null> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM refresh_sessions WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1;', [tokenHash]);
        return res.rows[0] || null;
      }
      const s = this.memRefreshSessions.get(tokenHash);
      if (s && !s.revoked_at) return s;
      return null;
    },

    rotate: async (oldTokenHash: string, newTokenHash: string, newExpiresAt: Date): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query(
          'UPDATE refresh_sessions SET token_hash = $1, expires_at = $2, last_used_at = $3 WHERE token_hash = $4;',
          [newTokenHash, newExpiresAt, now, oldTokenHash]
        );
        return;
      }
      const s = this.memRefreshSessions.get(oldTokenHash);
      if (s) {
        this.memRefreshSessions.delete(oldTokenHash);
        s.token_hash = newTokenHash;
        s.expires_at = newExpiresAt;
        s.last_used_at = now;
        this.memRefreshSessions.set(newTokenHash, s);
      }
    },

    revoke: async (tokenHash: string): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE refresh_sessions SET revoked_at = $1 WHERE token_hash = $2;', [now, tokenHash]);
        return;
      }
      const s = this.memRefreshSessions.get(tokenHash);
      if (s) s.revoked_at = now;
    },

    revokeAllForUser: async (userId: string): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE refresh_sessions SET revoked_at = $1 WHERE user_id = $2;', [now, userId]);
        return;
      }
      for (const s of this.memRefreshSessions.values()) {
        if (s.user_id === userId) s.revoked_at = now;
      }
    },
  };

  // ==========================================
  // TRANSFERS & FILES REPOSITORY
  // ==========================================
  readonly transfers = {
    createSession: async (session: {
      id: string;
      senderUserId?: string | null;
      senderDeviceId: string;
      receiverUserId?: string | null;
      receiverDeviceId: string;
      direction: string;
      fileCount: number;
      totalBytes: number;
    }): Promise<TransferSessionRow> => {
      const now = new Date();
      const row: TransferSessionRow = {
        id: session.id,
        sender_user_id: session.senderUserId || null,
        sender_device_id: session.senderDeviceId,
        receiver_user_id: session.receiverUserId || null,
        receiver_device_id: session.receiverDeviceId,
        status: 'REQUESTED',
        direction: session.direction,
        file_count: session.fileCount,
        total_bytes: session.totalBytes,
        transferred_bytes: 0,
        created_at: now,
      };

      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO transfer_sessions (id, sender_user_id, sender_device_id, receiver_user_id, receiver_device_id, status, direction, file_count, total_bytes, transferred_bytes, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *;
        `;
        const res = await this.pool.query(q, [
          row.id,
          row.sender_user_id,
          row.sender_device_id,
          row.receiver_user_id,
          row.receiver_device_id,
          row.status,
          row.direction,
          row.file_count,
          row.total_bytes,
          row.transferred_bytes,
          row.created_at,
        ]);
        return res.rows[0];
      }

      this.memTransfers.set(row.id, row);
      return row;
    },

    updateStatus: async (
      id: string,
      status: string,
      transferredBytes?: number,
      failureCode?: string
    ): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        let q = 'UPDATE transfer_sessions SET status = $1';
        const params: any[] = [status];
        if (transferredBytes !== undefined) {
          params.push(transferredBytes);
          q += `, transferred_bytes = $${params.length}`;
        }
        if (failureCode) {
          params.push(failureCode);
          q += `, failure_code = $${params.length}, failed_at = NOW()`;
        }
        if (status === 'COMPLETED') {
          q += ', completed_at = NOW()';
        } else if (status === 'ACCEPTED') {
          q += ', accepted_at = NOW()';
        } else if (status === 'TRANSFERRING') {
          q += ', started_at = NOW()';
        }
        params.push(id);
        q += ` WHERE id = $${params.length};`;
        await this.pool.query(q, params);
        return;
      }

      const s = this.memTransfers.get(id);
      if (s) {
        s.status = status;
        if (transferredBytes !== undefined) s.transferred_bytes = transferredBytes;
        if (failureCode) {
          s.failure_code = failureCode;
          s.failed_at = now;
        }
        if (status === 'COMPLETED') s.completed_at = now;
      }
    },

    addFile: async (file: {
      id: string;
      transferSessionId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      sha256: string;
    }): Promise<TransferFileRow> => {
      const now = new Date();
      const row: TransferFileRow = {
        id: file.id,
        transfer_session_id: file.transferSessionId,
        file_name: file.fileName,
        mime_type: file.mimeType,
        file_size: file.fileSize,
        sha256: file.sha256,
        verified_offset: 0,
        transferred_bytes: 0,
        status: 'PENDING',
        created_at: now,
      };

      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO transfer_files (id, transfer_session_id, file_name, mime_type, file_size, sha256, verified_offset, transferred_bytes, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *;
        `;
        const res = await this.pool.query(q, [
          row.id,
          row.transfer_session_id,
          row.file_name,
          row.mime_type,
          row.file_size,
          row.sha256,
          row.verified_offset,
          row.transferred_bytes,
          row.status,
          row.created_at,
        ]);
        return res.rows[0];
      }

      this.memTransferFiles.set(row.id, row);
      return row;
    },

    getHistoryByDeviceId: async (deviceId: string, limit: number = 50): Promise<TransferSessionRow[]> => {
      if (this.isConnectedToDb && this.pool) {
        const q = `
          SELECT * FROM transfer_sessions
          WHERE sender_device_id = $1 OR receiver_device_id = $1
          ORDER BY created_at DESC
          LIMIT $2;
        `;
        const res = await this.pool.query(q, [deviceId, limit]);
        return res.rows;
      }

      return Array.from(this.memTransfers.values())
        .filter((s) => s.sender_device_id === deviceId || s.receiver_device_id === deviceId)
        .slice(0, limit);
    },
  };

  // ==========================================
  // CONTACTS REPOSITORY
  // ==========================================
  readonly contacts = {
    add: async (ownerUserId: string, contactUserId: string, nickname?: string): Promise<any> => {
      const id = `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO contacts (id, owner_user_id, contact_user_id, nickname, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (owner_user_id, contact_user_id) DO UPDATE SET nickname = EXCLUDED.nickname
          RETURNING *;
        `;
        const res = await this.pool.query(q, [id, ownerUserId, contactUserId, nickname || null, now, now]);
        return res.rows[0];
      }
      const record = { id, owner_user_id: ownerUserId, contact_user_id: contactUserId, nickname, created_at: now };
      this.memContacts.set(`${ownerUserId}:${contactUserId}`, record);
      return record;
    },

    listByUserId: async (ownerUserId: string): Promise<any[]> => {
      if (this.isConnectedToDb && this.pool) {
        const q = `
          SELECT c.*, u.email, u.display_name, u.username, u.avatar_url
          FROM contacts c
          JOIN users u ON c.contact_user_id = u.id
          WHERE c.owner_user_id = $1;
        `;
        const res = await this.pool.query(q, [ownerUserId]);
        return res.rows;
      }
      return Array.from(this.memContacts.values()).filter((c) => c.owner_user_id === ownerUserId);
    },

    remove: async (ownerUserId: string, contactUserId: string): Promise<void> => {
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('DELETE FROM contacts WHERE owner_user_id = $1 AND contact_user_id = $2;', [ownerUserId, contactUserId]);
        return;
      }
      this.memContacts.delete(`${ownerUserId}:${contactUserId}`);
    },
  };

  // ==========================================
  // VISIBILITY REPOSITORY
  // ==========================================
  readonly visibility = {
    set: async (userId: string, mode: string): Promise<void> => {
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO visibility_settings (user_id, mode, updated_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = EXCLUDED.updated_at;
        `;
        await this.pool.query(q, [userId, mode, now]);
        return;
      }
      this.memVisibility.set(userId, mode);
    },

    get: async (userId: string): Promise<string> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT mode FROM visibility_settings WHERE user_id = $1 LIMIT 1;', [userId]);
        return res.rows[0]?.mode || 'EVERYONE';
      }
      return this.memVisibility.get(userId) || 'EVERYONE';
    },
  };

  // ==========================================
  // SECURITY AUDIT LOGGING
  // ==========================================
  readonly security = {
    logEvent: async (event: {
      userId?: string;
      deviceId?: string;
      eventType: string;
      severity: string;
      metadata?: any;
    }): Promise<void> => {
      const id = `sec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        const q = `
          INSERT INTO security_events (id, user_id, device_id, event_type, severity, metadata_json, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7);
        `;
        await this.pool.query(q, [
          id,
          event.userId || null,
          event.deviceId || null,
          event.eventType,
          event.severity,
          JSON.stringify(event.metadata || {}),
          now,
        ]);
        return;
      }
      this.memSecurityEvents.set(id, { id, ...event, created_at: now });
    },
  };
}
