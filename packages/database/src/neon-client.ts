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

export interface ConversationRow {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title?: string | null;
  avatar_url?: string | null;
  created_by?: string | null;
  disappearing_seconds: number;
  last_message_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationMemberRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joined_at: Date;
  last_read_at: Date;
  cleared_at?: Date | null;
  is_muted: boolean;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_msg_id?: string | null;
  text: string;
  type: 'TEXT' | 'FILE' | 'IMAGE' | 'SYSTEM';
  reply_to_id?: string | null;
  expires_at?: Date | null;
  is_deleted_everyone: boolean;
  created_at: Date;
  attachments?: MessageAttachmentRow[];
  sender?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
  };
}

export interface MessageAttachmentRow {
  id: string;
  message_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  file_hash?: string | null;
  file_url?: string | null;
  transfer_id?: string | null;
  created_at: Date;
}

export interface MessageReceiptRow {
  id: string;
  message_id: string;
  user_id: string;
  status: 'DELIVERED' | 'READ';
  updated_at: Date;
}

export interface UserMediaRow {
  id: string;
  user_id: string;
  media_type: 'AVATAR' | 'CHAT_MEDIA' | 'GROUP_AVATAR';
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  public_url: string;
  created_at: Date;
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
  private memConversations = new Map<string, ConversationRow>();
  private memConversationMembers = new Map<string, ConversationMemberRow>();
  private memMessages = new Map<string, MessageRow>();
  private memMessageAttachments = new Map<string, MessageAttachmentRow>();
  private memMessageReceipts = new Map<string, MessageReceiptRow>();
  private memUserMedia = new Map<string, UserMediaRow>();

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

  public lastError: string | null = null;

  private ensureDatabase(): void {
    if (!this.isConnectedToDb && process.env.NODE_ENV === 'production') {
      throw new Error(`[NeonDatabaseClient FATAL] Database unavailable in production: ${this.lastError || 'No connection to Neon'}`);
    }
  }

  async initialize(): Promise<void> {
    if (!this.pool) {
      this.isConnectedToDb = false;
      this.lastError = 'DATABASE_URL environment variable is required in production';
      if (process.env.NODE_ENV === 'production') {
        console.error('[NeonDatabaseClient FATAL] DATABASE_URL is not set in production. In-memory fallback is strictly disabled in production.');
        return;
      }
      console.log('[NeonDatabaseClient] No DATABASE_URL provided. Running in high-performance memory store mode.');
      return;
    }

    try {
      const client = await this.pool.connect();
      this.isConnectedToDb = true;
      this.lastError = null;
      console.log('[NeonDatabaseClient] Connected to Neon PostgreSQL database.');

      // Check or run migrations
      try {
        const migrations = ['001_initial_schema.sql', '002_chat_groups_schema.sql'];
        for (const m of migrations) {
          const migrationPaths = [
            path.resolve(__dirname, `../migrations/${m}`),
            path.resolve(__dirname, `../../packages/database/migrations/${m}`),
            path.resolve(process.cwd(), `packages/database/migrations/${m}`),
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
            console.log(`[NeonDatabaseClient] Executed migration ${m} successfully.`);
          }
        }
      } catch (mErr) {
        console.warn('[NeonDatabaseClient] Migration notice (tables may already exist):', mErr);
      } finally {
        client.release();
      }
    } catch (err: any) {
      this.isConnectedToDb = false;
      this.lastError = err.message;
      if (process.env.NODE_ENV === 'production') {
        console.error(`[NeonDatabaseClient FATAL] Production Neon connection failed: ${err.message}. Refusing in-memory fallback in production.`);
        return;
      }
      console.warn(`[NeonDatabaseClient] PostgreSQL connection failed: ${err.message}. Falling back to in-memory store.`);
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
      id?: string;
      email: string;
      passwordHash: string;
      displayName: string;
      username: string;
      avatarUrl?: string;
    }): Promise<UserRow> => {
      this.ensureDatabase();
      const emailNormalized = user.email.trim().toLowerCase();
      const now = new Date();
      const id = user.id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const row: UserRow = {
        id,
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
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1;', [id]);
        return res.rows[0] || null;
      }
      return this.memUsers.get(id) || null;
    },

    findByEmail: async (email: string): Promise<UserRow | null> => {
      this.ensureDatabase();
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
      this.ensureDatabase();
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
      this.ensureDatabase();
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

  // ==========================================
  // CONVERSATIONS & GROUPS REPOSITORY
  // ==========================================
  readonly conversations = {
    createDirect: async (userAId: string, userBId: string): Promise<ConversationRow> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        // Check if direct conversation already exists
        const checkQ = `
          SELECT c.id, c.type, c.title, c.avatar_url, c.created_by, c.disappearing_seconds, c.last_message_at, c.created_at, c.updated_at
          FROM conversations c
          JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
          JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
          WHERE c.type = 'DIRECT' LIMIT 1;
        `;
        const existing = await this.pool.query(checkQ, [userAId, userBId]);
        if (existing.rows.length > 0) {
          return existing.rows[0];
        }

        const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await this.pool.query(
          `INSERT INTO conversations (id, type, created_by, created_at, updated_at, last_message_at) VALUES ($1, 'DIRECT', $2, $3, $3, $3);`,
          [convId, userAId, now]
        );
        await this.pool.query(
          `INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at, last_read_at)
           VALUES ($1, $2, $3, 'MEMBER', $4, $4), ($5, $2, $6, 'MEMBER', $4, $4);`,
          [`cm_${Date.now()}_a`, convId, userAId, now, `cm_${Date.now()}_b`, userBId]
        );
        const res = await this.pool.query('SELECT * FROM conversations WHERE id = $1;', [convId]);
        return res.rows[0];
      }

      // In-memory fallback
      for (const conv of this.memConversations.values()) {
        if (conv.type === 'DIRECT') {
          const members = Array.from(this.memConversationMembers.values()).filter(m => m.conversation_id === conv.id);
          const uIds = members.map(m => m.user_id);
          if (uIds.includes(userAId) && uIds.includes(userBId)) {
            return conv;
          }
        }
      }
      const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newConv: ConversationRow = {
        id: convId,
        type: 'DIRECT',
        created_by: userAId,
        disappearing_seconds: 0,
        last_message_at: now,
        created_at: now,
        updated_at: now,
      };
      this.memConversations.set(convId, newConv);
      this.memConversationMembers.set(`cm_${convId}_${userAId}`, {
        id: `cm_${convId}_${userAId}`,
        conversation_id: convId,
        user_id: userAId,
        role: 'MEMBER',
        joined_at: now,
        last_read_at: now,
        is_muted: false,
      });
      this.memConversationMembers.set(`cm_${convId}_${userBId}`, {
        id: `cm_${convId}_${userBId}`,
        conversation_id: convId,
        user_id: userBId,
        role: 'MEMBER',
        joined_at: now,
        last_read_at: now,
        is_muted: false,
      });
      return newConv;
    },

    createGroup: async (title: string, creatorId: string, memberIds: string[], avatarUrl?: string): Promise<ConversationRow> => {
      this.ensureDatabase();
      const now = new Date();
      const convId = `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const allMembers = Array.from(new Set([creatorId, ...memberIds]));

      if (this.isConnectedToDb && this.pool) {
        await this.pool.query(
          `INSERT INTO conversations (id, type, title, avatar_url, created_by, created_at, updated_at, last_message_at)
           VALUES ($1, 'GROUP', $2, $3, $4, $5, $5, $5);`,
          [convId, title, avatarUrl || null, creatorId, now]
        );
        for (const mId of allMembers) {
          const role = mId === creatorId ? 'OWNER' : 'MEMBER';
          await this.pool.query(
            `INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at, last_read_at)
             VALUES ($1, $2, $3, $4, $5, $5);`,
            [`cm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, convId, mId, role, now]
          );
        }
        const res = await this.pool.query('SELECT * FROM conversations WHERE id = $1;', [convId]);
        return res.rows[0];
      }

      const newConv: ConversationRow = {
        id: convId,
        type: 'GROUP',
        title,
        avatar_url: avatarUrl || null,
        created_by: creatorId,
        disappearing_seconds: 0,
        last_message_at: now,
        created_at: now,
        updated_at: now,
      };
      this.memConversations.set(convId, newConv);
      for (const mId of allMembers) {
        const memId = `cm_${convId}_${mId}`;
        this.memConversationMembers.set(memId, {
          id: memId,
          conversation_id: convId,
          user_id: mId,
          role: mId === creatorId ? 'OWNER' : 'MEMBER',
          joined_at: now,
          last_read_at: now,
          is_muted: false,
        });
      }
      return newConv;
    },

    findById: async (conversationId: string): Promise<ConversationRow | null> => {
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('SELECT * FROM conversations WHERE id = $1;', [conversationId]);
        return res.rows[0] || null;
      }
      return this.memConversations.get(conversationId) || null;
    },

    listForUser: async (userId: string): Promise<any[]> => {
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        const q = `
          SELECT 
            c.id, c.type, c.title, c.avatar_url, c.created_by, c.disappearing_seconds, c.last_message_at, c.created_at, c.updated_at,
            cm.role, cm.last_read_at, cm.cleared_at, cm.is_muted,
            (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar_url', u.avatar_url, 'role', cm2.role))
             FROM conversation_members cm2
             JOIN users u ON u.id = cm2.user_id
             WHERE cm2.conversation_id = c.id) as members,
            (SELECT json_build_object('id', m.id, 'sender_id', m.sender_id, 'text', m.text, 'type', m.type, 'created_at', m.created_at, 'is_deleted_everyone', m.is_deleted_everyone)
             FROM messages m
             WHERE m.conversation_id = c.id
               AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
               AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC LIMIT 1) as last_message,
            (SELECT count(*)::int
             FROM messages m
             WHERE m.conversation_id = c.id
               AND m.sender_id != $1
               AND m.created_at > cm.last_read_at
               AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
               AND (m.expires_at IS NULL OR m.expires_at > NOW())) as unread_count
          FROM conversations c
          JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
          ORDER BY c.last_message_at DESC;
        `;
        const res = await this.pool.query(q, [userId]);
        return res.rows;
      }

      // Memory fallback
      const userConvs = Array.from(this.memConversationMembers.values())
        .filter(cm => cm.user_id === userId)
        .map(cm => {
          const c = this.memConversations.get(cm.conversation_id);
          if (!c) return null;
          const members = Array.from(this.memConversationMembers.values())
            .filter(m => m.conversation_id === c.id)
            .map(m => {
              const u = this.memUsers.get(m.user_id);
              return {
                id: m.user_id,
                username: u?.username || 'user',
                display_name: u?.display_name || 'User',
                avatar_url: u?.avatar_url || null,
                role: m.role,
              };
            });
          return {
            ...c,
            role: cm.role,
            last_read_at: cm.last_read_at,
            cleared_at: cm.cleared_at,
            is_muted: cm.is_muted,
            members,
            last_message: null,
            unread_count: 0,
          };
        })
        .filter(Boolean);
      return userConvs.sort((a: any, b: any) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
    },

    setDisappearing: async (conversationId: string, seconds: number): Promise<void> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE conversations SET disappearing_seconds = $2, updated_at = $3 WHERE id = $1;', [conversationId, seconds, now]);
        return;
      }
      const c = this.memConversations.get(conversationId);
      if (c) {
        c.disappearing_seconds = seconds;
        c.updated_at = now;
      }
    },

    clearChat: async (conversationId: string, userId: string): Promise<void> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE conversation_members SET cleared_at = $3 WHERE conversation_id = $1 AND user_id = $2;', [conversationId, userId, now]);
        return;
      }
      const key = `cm_${conversationId}_${userId}`;
      const m = this.memConversationMembers.get(key);
      if (m) m.cleared_at = now;
    },

    addMember: async (conversationId: string, userId: string, role = 'MEMBER'): Promise<void> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        const id = `cm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await this.pool.query(
          `INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at, last_read_at)
           VALUES ($1, $2, $3, $4, $5, $5)
           ON CONFLICT (conversation_id, user_id) DO NOTHING;`,
          [id, conversationId, userId, role, now]
        );
        return;
      }
      const key = `cm_${conversationId}_${userId}`;
      this.memConversationMembers.set(key, {
        id: key,
        conversation_id: conversationId,
        user_id: userId,
        role: role as any,
        joined_at: now,
        last_read_at: now,
        is_muted: false,
      });
    },

    removeMember: async (conversationId: string, userId: string): Promise<void> => {
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2;', [conversationId, userId]);
        return;
      }
      this.memConversationMembers.delete(`cm_${conversationId}_${userId}`);
    },

    getMembers: async (conversationId: string): Promise<any[]> => {
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        const q = `
          SELECT cm.id, cm.conversation_id, cm.user_id, cm.role, cm.joined_at, cm.last_read_at, cm.is_muted,
                 u.username, u.display_name, u.avatar_url
          FROM conversation_members cm
          JOIN users u ON u.id = cm.user_id
          WHERE cm.conversation_id = $1;
        `;
        const res = await this.pool.query(q, [conversationId]);
        return res.rows;
      }
      return Array.from(this.memConversationMembers.values())
        .filter(m => m.conversation_id === conversationId)
        .map(m => {
          const u = this.memUsers.get(m.user_id);
          return { ...m, username: u?.username || 'user', display_name: u?.display_name || 'User', avatar_url: u?.avatar_url || null };
        });
    },
  };

  // ==========================================
  // MESSAGES REPOSITORY
  // ==========================================
  readonly messages = {
    create: async (data: {
      conversationId: string;
      senderId: string;
      clientMsgId?: string;
      text?: string;
      type?: 'TEXT' | 'FILE' | 'IMAGE' | 'SYSTEM';
      replyToId?: string;
      expiresAt?: Date | null;
      attachments?: Array<{
        fileName: string;
        fileSize: number;
        mimeType: string;
        fileHash?: string;
        fileUrl?: string;
        transferId?: string;
      }>;
    }): Promise<MessageRow> => {
      this.ensureDatabase();
      const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();
      const msgType = data.type || 'TEXT';
      const text = data.text || '';

      // Calculate expiration if conversation has disappearing timer enabled
      let finalExpiresAt = data.expiresAt || null;
      if (!finalExpiresAt) {
        const conv = await this.conversations.findById(data.conversationId);
        if (conv && conv.disappearing_seconds > 0) {
          finalExpiresAt = new Date(now.getTime() + conv.disappearing_seconds * 1000);
        }
      }

      if (this.isConnectedToDb && this.pool) {
        await this.pool.query(
          `INSERT INTO messages (id, conversation_id, sender_id, client_msg_id, text, type, reply_to_id, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
          [id, data.conversationId, data.senderId, data.clientMsgId || null, text, msgType, data.replyToId || null, finalExpiresAt, now]
        );

        // Update conversation last_message_at
        await this.pool.query('UPDATE conversations SET last_message_at = $2, updated_at = $2 WHERE id = $1;', [data.conversationId, now]);

        // Insert attachments
        const insertedAttachments: MessageAttachmentRow[] = [];
        if (data.attachments && data.attachments.length > 0) {
          for (const att of data.attachments) {
            const attId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            await this.pool.query(
              `INSERT INTO message_attachments (id, message_id, file_name, file_size, mime_type, file_hash, file_url, transfer_id, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
              [attId, id, att.fileName, att.fileSize, att.mimeType, att.fileHash || null, att.fileUrl || null, att.transferId || null, now]
            );
            insertedAttachments.push({
              id: attId,
              message_id: id,
              file_name: att.fileName,
              file_size: att.fileSize,
              mime_type: att.mimeType,
              file_hash: att.fileHash || null,
              file_url: att.fileUrl || null,
              transfer_id: att.transferId || null,
              created_at: now,
            });
          }
        }

        // Get sender profile
        const senderRes = await this.pool.query('SELECT id, username, display_name, avatar_url FROM users WHERE id = $1;', [data.senderId]);
        const sender = senderRes.rows[0];

        return {
          id,
          conversation_id: data.conversationId,
          sender_id: data.senderId,
          client_msg_id: data.clientMsgId || null,
          text,
          type: msgType,
          reply_to_id: data.replyToId || null,
          expires_at: finalExpiresAt,
          is_deleted_everyone: false,
          created_at: now,
          attachments: insertedAttachments,
          sender,
        };
      }

      // Memory store fallback
      const row: MessageRow = {
        id,
        conversation_id: data.conversationId,
        sender_id: data.senderId,
        client_msg_id: data.clientMsgId || null,
        text,
        type: msgType,
        reply_to_id: data.replyToId || null,
        expires_at: finalExpiresAt,
        is_deleted_everyone: false,
        created_at: now,
      };
      this.memMessages.set(id, row);
      const u = this.memUsers.get(data.senderId);
      row.sender = u ? { id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url } : undefined;
      return row;
    },

    list: async (conversationId: string, userId: string, cursor?: string, limit = 50): Promise<MessageRow[]> => {
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        // First check member's cleared_at
        const memberRes = await this.pool.query('SELECT cleared_at FROM conversation_members WHERE conversation_id = $1 AND user_id = $2;', [conversationId, userId]);
        const clearedAt = memberRes.rows[0]?.cleared_at || null;

        let q = `
          SELECT m.id, m.conversation_id, m.sender_id, m.client_msg_id, m.text, m.type, m.reply_to_id, m.expires_at, m.is_deleted_everyone, m.created_at,
                 json_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar_url', u.avatar_url) as sender,
                 COALESCE(
                   (SELECT json_agg(json_build_object(
                      'id', att.id, 'file_name', att.file_name, 'file_size', att.file_size,
                      'mime_type', att.mime_type, 'file_hash', att.file_hash, 'file_url', att.file_url, 'transfer_id', att.transfer_id
                    ))
                    FROM message_attachments att WHERE att.message_id = m.id),
                   '[]'::json
                 ) as attachments
          FROM messages m
          JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = $1
            AND (m.expires_at IS NULL OR m.expires_at > NOW())
        `;
        const params: any[] = [conversationId];

        if (clearedAt) {
          params.push(clearedAt);
          q += ` AND m.created_at > $${params.length}`;
        }
        if (cursor) {
          params.push(cursor);
          q += ` AND m.created_at < $${params.length}`;
        }

        params.push(limit);
        q += ` ORDER BY m.created_at DESC LIMIT $${params.length};`;

        const res = await this.pool.query(q, params);
        return res.rows.reverse(); // Return in chronological order for UI rendering
      }

      // Memory fallback
      const msgs = Array.from(this.memMessages.values())
        .filter(m => m.conversation_id === conversationId && (!m.expires_at || m.expires_at.getTime() > Date.now()))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return msgs.slice(-limit);
    },

    deleteForEveryone: async (messageId: string, senderId: string): Promise<boolean> => {
      this.ensureDatabase();
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query(
          `UPDATE messages SET is_deleted_everyone = TRUE, text = 'This message was deleted'
           WHERE id = $1 AND sender_id = $2 RETURNING id;`,
          [messageId, senderId]
        );
        if (res.rows.length > 0) {
          await this.pool.query('DELETE FROM message_attachments WHERE message_id = $1;', [messageId]);
          return true;
        }
        return false;
      }
      const m = this.memMessages.get(messageId);
      if (m && m.sender_id === senderId) {
        m.is_deleted_everyone = true;
        m.text = 'This message was deleted';
        m.attachments = [];
        return true;
      }
      return false;
    },

    markConversationRead: async (conversationId: string, userId: string): Promise<void> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE conversation_members SET last_read_at = $3 WHERE conversation_id = $1 AND user_id = $2;', [conversationId, userId, now]);
        return;
      }
      const key = `cm_${conversationId}_${userId}`;
      const m = this.memConversationMembers.get(key);
      if (m) m.last_read_at = now;
    },

    cleanupExpired: async (): Promise<number> => {
      if (this.isConnectedToDb && this.pool) {
        const res = await this.pool.query('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= NOW();');
        return res.rowCount || 0;
      }
      let count = 0;
      const now = Date.now();
      for (const [id, m] of this.memMessages.entries()) {
        if (m.expires_at && m.expires_at.getTime() <= now) {
          this.memMessages.delete(id);
          count++;
        }
      }
      return count;
    },
  };

  // ==========================================
  // MEDIA & AVATAR STORAGE REPOSITORY
  // ==========================================
  readonly media = {
    recordUpload: async (data: {
      userId: string;
      mediaType: 'AVATAR' | 'CHAT_MEDIA' | 'GROUP_AVATAR';
      fileName: string;
      fileSize: number;
      mimeType: string;
      storagePath: string;
      publicUrl: string;
    }): Promise<UserMediaRow> => {
      this.ensureDatabase();
      const id = `med_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();

      if (this.isConnectedToDb && this.pool) {
        await this.pool.query(
          `INSERT INTO user_media (id, user_id, media_type, file_name, file_size, mime_type, storage_path, public_url, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
          [id, data.userId, data.mediaType, data.fileName, data.fileSize, data.mimeType, data.storagePath, data.publicUrl, now]
        );
        const row: UserMediaRow = {
          id,
          user_id: data.userId,
          media_type: data.mediaType,
          file_name: data.fileName,
          file_size: data.fileSize,
          mime_type: data.mimeType,
          storage_path: data.storagePath,
          public_url: data.publicUrl,
          created_at: now,
        };
        return row;
      }

      const row: UserMediaRow = {
        id,
        user_id: data.userId,
        media_type: data.mediaType,
        file_name: data.fileName,
        file_size: data.fileSize,
        mime_type: data.mimeType,
        storage_path: data.storagePath,
        public_url: data.publicUrl,
        created_at: now,
      };
      this.memUserMedia.set(id, row);
      return row;
    },

    updateUserAvatar: async (userId: string, avatarUrl: string): Promise<void> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE users SET avatar_url = $2, updated_at = $3 WHERE id = $1;', [userId, avatarUrl, now]);
        return;
      }
      const u = this.memUsers.get(userId);
      if (u) {
        u.avatar_url = avatarUrl;
        u.updated_at = now;
      }
    },

    removeUserAvatar: async (userId: string): Promise<void> => {
      this.ensureDatabase();
      const now = new Date();
      if (this.isConnectedToDb && this.pool) {
        await this.pool.query('UPDATE users SET avatar_url = NULL, updated_at = $2 WHERE id = $1;', [userId, now]);
        return;
      }
      const u = this.memUsers.get(userId);
      if (u) {
        u.avatar_url = null;
        u.updated_at = now;
      }
    },
  };
}
