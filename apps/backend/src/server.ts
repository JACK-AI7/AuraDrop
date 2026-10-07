import * as http from 'node:http';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer } from 'ws';
import { AuthService } from './auth/auth.service';
import {
  UsersService,
  DevicesService,
  PresenceService,
  SessionsService,
  PairingService,
  NotificationsService,
  TransferMetadataService,
  SettingsService,
  AnalyticsService,
} from './services';
import { WebSocketGateway } from './gateway/websocket.gateway';
import { RedisRealtimeService } from './redis/redis.service';
import { NeonDatabaseClient } from '@auradrop/database';

export class BackendServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private wsGateway: WebSocketGateway;

  public authService = new AuthService();
  public usersService = new UsersService();
  public devicesService = new DevicesService();
  public presenceService = new PresenceService();
  public sessionsService = new SessionsService();
  public pairingService = new PairingService();
  public notificationsService = new NotificationsService();
  public transferMetadataService = new TransferMetadataService();
  public settingsService = new SettingsService();
  public analyticsService = new AnalyticsService();

  public db = new NeonDatabaseClient();
  public redisService = new RedisRealtimeService();

  constructor() {
    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ server: this.server });
    this.wsGateway = new WebSocketGateway(
      this.wss,
      this.presenceService,
      this.redisService,
      this.db
    );
  }

  async listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    await this.db.initialize();
    await this.redisService.initialize();

    return new Promise((resolve) => {
      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await this.redisService.close();
    await this.db.close();

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }

  public async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Security Headers (Section 20: OWASP & Strict Headers)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const clientIp = req.socket.remoteAddress || '127.0.0.1';

    try {
      // Root / Status info
      if ((pathname === '/' || pathname === '/api') && req.method === 'GET') {
        this.sendJson(res, 200, {
          service: 'AuraDrop Backend Cluster Gateway',
          status: 'online',
          version: '16.0.0',
          timestamp: Date.now(),
          node: this.redisService.getInstanceId(),
          database: this.db.isConnectedToDb ? 'neon-postgresql' : 'in-memory-fallback',
          endpoints: [
            '/health',
            '/ws-health',
            '/api/turn-credentials',
            '/auth/register',
            '/auth/login',
            '/auth/refresh',
            '/auth/logout',
            '/auth/me',
            '/devices',
            '/contacts',
            '/visibility',
            '/transfers/history',
            '/presence/active',
            '/analytics/summary'
          ]
        });
        return;
      }

      // Liveness probe (Section 47)
      if (pathname === '/live' && req.method === 'GET') {
        this.sendJson(res, 200, { status: 'ALIVE', uptime: process.uptime(), timestamp: Date.now() });
        return;
      }

      // Readiness probe (Section 43 & 47): strictly fails if Neon is down in production
      if (pathname === '/ready' && req.method === 'GET') {
        const isProd = process.env.NODE_ENV === 'production';
        if (isProd && !this.db.isConnectedToDb) {
          this.sendJson(res, 503, {
            status: 'NOT_READY',
            service: 'AuraDrop-Backend-V17',
            error: 'Neon PostgreSQL database is disconnected or unavailable in production',
            database: 'disconnected',
            timestamp: Date.now(),
          });
          return;
        }
        this.sendJson(res, 200, {
          status: 'READY',
          service: 'AuraDrop-Backend-V17',
          database: this.db.isConnectedToDb ? 'connected' : 'memory_fallback',
          timestamp: Date.now(),
        });
        return;
      }

      // Comprehensive Health Check (Section 47)
      if (pathname === '/health' && req.method === 'GET') {
        const isProd = process.env.NODE_ENV === 'production';
        const isHealthy = !isProd || this.db.isConnectedToDb;
        const statusCode = isHealthy ? 200 : 503;

        this.sendJson(res, statusCode, {
          status: isHealthy ? 'healthy' : 'unhealthy',
          service: 'AuraDrop-Backend-V17',
          timestamp: Date.now(),
          uptime: process.uptime(),
          components: {
            neon: {
              status: this.db.isConnectedToDb ? 'connected' : (isProd ? 'error' : 'memory_fallback'),
              error: this.db.lastError,
            },
            redis: {
              status: this.redisService.status,
              connected: this.redisService.isRedisConnected,
              nodeId: this.redisService.getInstanceId(),
            },
            websocket: {
              status: 'ready',
              activeClients: this.wsGateway.getConnectedPeers().length,
            },
            turn: {
              status: 'configured',
              host: process.env.TURN_HOST || 'turn.auradrop.network',
            },
          },
          connectedPeers: this.wsGateway.getConnectedPeers(),
        });
        return;
      }

      if (pathname === '/ws-health' && req.method === 'GET') {
        this.sendJson(res, 200, {
          websocketReady: true,
          activeClients: this.wsGateway.getConnectedPeers().length,
          timestamp: Date.now(),
        });
        return;
      }

      // Section 12: Ephemeral coturn STUN/TURN Credentials
      if (pathname === '/api/turn-credentials' && req.method === 'GET') {
        const userId = url.searchParams.get('userId') || 'guest';
        const creds = this.authService.generateTurnCredentials(userId, 86400);
        this.sendJson(res, 200, creds);
        return;
      }

      // Static Uploads Serving (Avatars & Chat Media)
      if (pathname.startsWith('/uploads/') && req.method === 'GET') {
        const safePath = path.normalize(pathname.replace(/^\/uploads\//, '')).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.resolve(process.cwd(), 'apps/backend/uploads', safePath);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(fullPath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
          };
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
          });
          fs.createReadStream(fullPath).pipe(res);
          return;
        } else {
          return this.sendJson(res, 404, { error: 'Upload not found' });
        }
      }

      // Read Body for POST/PUT/DELETE requests
      let body: any = {};
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        const raw = await this.readBody(req);
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            this.sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
          }
        }
      }

      // ==========================================
      // SECTION 8: AUTH REST ENDPOINTS
      // ==========================================
      if (pathname === '/auth/register' && req.method === 'POST') {
        if (process.env.NODE_ENV === 'production' && !this.db.isConnectedToDb) {
          return this.sendJson(res, 503, { error: 'Database service unavailable. Cannot process authentication without durable persistence.' });
        }
        // Rate limit: 10 per minute per IP
        const rate = await this.redisService.checkRateLimit(`reg:${clientIp}`, 10, 60);
        if (!rate.allowed) {
          return this.sendJson(res, 429, { error: 'Too many registration requests. Try again later.' });
        }

        const { username, displayName, email, password } = body;
        if (!username || !email || !password) {
          return this.sendJson(res, 400, { error: 'Username, email, and password are required' });
        }

        // Check if user already exists
        const existingEmail = await this.db.users.findByEmail(email);
        if (existingEmail) {
          return this.sendJson(res, 409, { error: 'An account with this email already exists' });
        }

        const existingUsername = await this.db.users.findByUsername(username);
        if (existingUsername) {
          return this.sendJson(res, 409, { error: 'Username is already taken' });
        }

        const passwordHash = await this.authService.hashPassword(password);
        const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const user = await this.db.users.create({
          id: userId,
          email,
          passwordHash,
          displayName: displayName || username,
          username,
        });

        // Initialize user preferences
        await this.db.preferences.upsert(userId, {
          theme: 'dark',
          language: 'en',
          auto_accept: false,
          default_visibility: 'EVERYONE',
        });

        // Issue tokens
        const accessToken = this.authService.generateAccessToken({
          userId: user.id,
          username: user.username,
          email: user.email,
        });

        const refresh = this.authService.generateRefreshToken();
        await this.db.refreshSessions.create({
          id: `ref_${Date.now()}`,
          userId: user.id,
          deviceId: body.deviceId || 'web_client',
          tokenHash: refresh.hash,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), // 30 days
        });

        return this.sendJson(res, 201, {
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            email: user.email,
          },
          accessToken,
          refreshToken: refresh.token,
          expiresIn: 900,
        });
      }

      if (pathname === '/auth/login' && req.method === 'POST') {
        if (process.env.NODE_ENV === 'production' && !this.db.isConnectedToDb) {
          return this.sendJson(res, 503, { error: 'Database service unavailable. Cannot authenticate without durable persistence.' });
        }
        // Rate limit: 20 per minute per IP
        const rate = await this.redisService.checkRateLimit(`login:${clientIp}`, 20, 60);
        if (!rate.allowed) {
          return this.sendJson(res, 429, { error: 'Too many login attempts. Please wait.' });
        }

        const { login, password, deviceId } = body;
        if (!login || !password) {
          return this.sendJson(res, 400, { error: 'Login identifier (email or username) and password required' });
        }

        let user = await this.db.users.findByEmail(login);
        if (!user) {
          user = await this.db.users.findByUsername(login);
        }

        if (!user) {
          return this.sendJson(res, 401, { error: 'Invalid credentials' });
        }

        const isMatch = await this.authService.comparePassword(password, user.password_hash);
        if (!isMatch) {
          await this.db.security.logEvent({
            userId: user.id,
            deviceId,
            eventType: 'login_failure',
            severity: 'medium',
            metadata: { ip: clientIp },
          });
          return this.sendJson(res, 401, { error: 'Invalid credentials' });
        }

        await this.db.users.updateLastLogin(user.id);

        const accessToken = this.authService.generateAccessToken({
          userId: user.id,
          username: user.username,
          email: user.email,
          deviceId,
        });

        const refresh = this.authService.generateRefreshToken();
        await this.db.refreshSessions.create({
          id: `ref_${Date.now()}`,
          userId: user.id,
          deviceId: deviceId || 'web_client',
          tokenHash: refresh.hash,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        });

        return this.sendJson(res, 200, {
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            email: user.email,
          },
          accessToken,
          refreshToken: refresh.token,
          expiresIn: 900,
        });
      }

      if (pathname === '/auth/refresh' && req.method === 'POST') {
        const { refreshToken } = body;
        if (!refreshToken) {
          return this.sendJson(res, 400, { error: 'Refresh token required' });
        }

        const tokenHash = this.authService.hashToken(refreshToken);
        const session = await this.db.refreshSessions.findByTokenHash(tokenHash);

        if (!session || new Date() > new Date(session.expires_at)) {
          return this.sendJson(res, 401, { error: 'Invalid or expired refresh token' });
        }

        const user = await this.db.users.findById(session.user_id);
        if (!user) {
          return this.sendJson(res, 401, { error: 'User not found' });
        }

        // Token rotation
        const newRefresh = this.authService.generateRefreshToken();
        const newExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        await this.db.refreshSessions.rotate(tokenHash, newRefresh.hash, newExpiresAt);

        const accessToken = this.authService.generateAccessToken({
          userId: user.id,
          username: user.username,
          email: user.email,
        });

        return this.sendJson(res, 200, {
          accessToken,
          refreshToken: newRefresh.token,
          expiresIn: 900,
        });
      }

      if (pathname === '/auth/logout' && req.method === 'POST') {
        const { refreshToken } = body;
        if (refreshToken) {
          const tokenHash = this.authService.hashToken(refreshToken);
          await this.db.refreshSessions.revoke(tokenHash);
        }
        return this.sendJson(res, 200, { success: true });
      }

      // Verify Authenticated Requests for User Data
      const authHeader = req.headers['authorization'];
      let currentUser: any = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        currentUser = this.authService.verifyAccessToken(token);
      }

      if (pathname === '/auth/me' && req.method === 'GET') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const user = await this.db.users.findById(currentUser.userId);
        const prefs = await this.db.preferences.findByUserId(currentUser.userId);
        return this.sendJson(res, 200, { user, preferences: prefs });
      }

      // ==========================================
      // SECTION 8 & 9: DEVICES MANAGEMENT
      // ==========================================
      if (pathname === '/devices' && req.method === 'GET') {
        const userId = currentUser ? currentUser.userId : url.searchParams.get('userId');
        if (!userId) return this.sendJson(res, 400, { error: 'userId is required' });
        const devices = await this.db.devices.findByUserId(userId);
        return this.sendJson(res, 200, { devices });
      }

      if (pathname === '/devices/register' && req.method === 'POST') {
        const { userId, deviceName, platform, publicKey, capabilities } = body;
        if (!deviceName || !platform || !publicKey) {
          return this.sendJson(res, 400, { error: 'deviceName, platform, and publicKey are required' });
        }
        const devId = body.deviceId || `dev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const device = await this.db.devices.register({
          id: devId,
          userId: userId || currentUser?.userId || null,
          deviceName,
          platform,
          devicePublicKey: publicKey,
          capabilitiesJson: capabilities || {},
        });
        return this.sendJson(res, 201, { device });
      }

      // ==========================================
      // SECTION 9: CONTACTS & VISIBILITY
      // ==========================================
      if (pathname === '/contacts' && req.method === 'GET') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const contacts = await this.db.contacts.listByUserId(currentUser.userId);
        return this.sendJson(res, 200, { contacts });
      }

      if (pathname === '/contacts' && req.method === 'POST') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const { contactUserId, nickname } = body;
        const contact = await this.db.contacts.add(currentUser.userId, contactUserId, nickname);
        return this.sendJson(res, 201, { contact });
      }

      if (pathname === '/visibility' && req.method === 'GET') {
        const userId = currentUser?.userId || url.searchParams.get('userId') || 'guest';
        const mode = await this.db.visibility.get(userId);
        return this.sendJson(res, 200, { mode });
      }

      if (pathname === '/visibility' && req.method === 'PUT') {
        const userId = currentUser?.userId || body.userId || 'guest';
        const mode = body.mode || 'EVERYONE';
        await this.db.visibility.set(userId, mode);
        return this.sendJson(res, 200, { mode });
      }

      // ==========================================
      // SECTION 9 & 24: TRANSFERS HISTORY
      // ==========================================
      if (pathname === '/transfers/history' && req.method === 'GET') {
        const deviceId = url.searchParams.get('deviceId') || '';
        const history = await this.db.transfers.getHistoryByDeviceId(deviceId, 50);
        return this.sendJson(res, 200, { history });
      }

      // Presence Active
      if (pathname === '/presence/active' && req.method === 'GET') {
        const activePeers = await this.redisService.getActivePeers();
        return this.sendJson(res, 200, { activePeers, count: activePeers.length });
      }

      // Legacy Pairing
      if (pathname === '/pairing/create' && req.method === 'POST') {
        const { initiatorDeviceId, receiverDeviceId, pairingMethod } = body;
        const pairing = this.pairingService.createPairing(
          initiatorDeviceId,
          receiverDeviceId,
          pairingMethod || 'qr'
        );
        return this.sendJson(res, 201, { pairing });
      }

      // ==========================================
      // SECTION 9 & 31: REAL PROFILE AVATAR UPLOAD & DELETE
      // ==========================================
      if (pathname === '/api/users/avatar' && req.method === 'POST') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const { imageBase64, mimeType } = body;
        if (!imageBase64 || !mimeType) {
          return this.sendJson(res, 400, { error: 'imageBase64 and mimeType required' });
        }
        const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (!allowedMimes.includes(mimeType)) {
          return this.sendJson(res, 400, { error: 'Invalid image format. Allowed: PNG, JPEG, WEBP, GIF' });
        }
        const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        if (buffer.length > 5 * 1024 * 1024) {
          return this.sendJson(res, 400, { error: 'Image exceeds maximum 5MB size limit' });
        }
        const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.jpg';
        const filename = `avatar_${currentUser.userId}_${Date.now()}${ext}`;
        const uploadDir = path.resolve(process.cwd(), 'apps/backend/uploads/avatars');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        const publicUrl = `/uploads/avatars/${filename}`;

        await this.db.media.recordUpload({
          userId: currentUser.userId,
          mediaType: 'AVATAR',
          fileName: filename,
          fileSize: buffer.length,
          mimeType,
          storagePath: `uploads/avatars/${filename}`,
          publicUrl,
        });
        await this.db.media.updateUserAvatar(currentUser.userId, publicUrl);

        return this.sendJson(res, 200, {
          success: true,
          avatarUrl: publicUrl,
        });
      }

      if (pathname === '/api/users/avatar' && req.method === 'DELETE') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        await this.db.media.removeUserAvatar(currentUser.userId);
        return this.sendJson(res, 200, { success: true });
      }

      // ==========================================
      // SECTION 2, 3, 4, 7, 8: CHAT & GROUPS REST API
      // ==========================================
      if (pathname === '/api/conversations' && req.method === 'GET') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const conversations = await this.db.conversations.listForUser(currentUser.userId);
        return this.sendJson(res, 200, { conversations });
      }

      if (pathname === '/api/conversations/direct' && req.method === 'POST') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const { targetUserId } = body;
        if (!targetUserId) return this.sendJson(res, 400, { error: 'targetUserId is required' });
        const conversation = await this.db.conversations.createDirect(currentUser.userId, targetUserId);
        return this.sendJson(res, 200, { conversation });
      }

      if (pathname === '/api/conversations/group' && req.method === 'POST') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const { title, memberIds, avatarUrl } = body;
        if (!title || !Array.isArray(memberIds)) {
          return this.sendJson(res, 400, { error: 'title and memberIds array are required' });
        }
        const conversation = await this.db.conversations.createGroup(title, currentUser.userId, memberIds, avatarUrl);
        return this.sendJson(res, 201, { conversation });
      }

      // /api/conversations/:id/messages
      const convMsgMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (convMsgMatch) {
        const conversationId = convMsgMatch[1];
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });

        if (req.method === 'GET') {
          const cursor = url.searchParams.get('cursor') || undefined;
          const limit = parseInt(url.searchParams.get('limit') || '50', 10);
          const messages = await this.db.messages.list(conversationId, currentUser.userId, cursor, limit);
          return this.sendJson(res, 200, { messages });
        }

        if (req.method === 'POST') {
          const { text, type, replyToId, attachments, clientMsgId } = body;
          const message = await this.db.messages.create({
            conversationId,
            senderId: currentUser.userId,
            clientMsgId,
            text,
            type: type || 'TEXT',
            replyToId,
            attachments,
          });

          // Broadcast to conversation members via WebSocket & Redis cluster
          const members = await this.db.conversations.getMembers(conversationId);
          this.wsGateway.broadcastChatMessage(conversationId, message, members.map(m => m.user_id));

          return this.sendJson(res, 201, { message });
        }
      }

      // /api/conversations/:id/disappearing
      const convDisMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/disappearing$/);
      if (convDisMatch && req.method === 'PUT') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const conversationId = convDisMatch[1];
        const seconds = parseInt(body.seconds || '0', 10);
        await this.db.conversations.setDisappearing(conversationId, seconds);
        return this.sendJson(res, 200, { success: true, disappearingSeconds: seconds });
      }

      // /api/conversations/:id/clear
      const convClearMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/clear$/);
      if (convClearMatch && req.method === 'DELETE') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const conversationId = convClearMatch[1];
        await this.db.conversations.clearChat(conversationId, currentUser.userId);
        return this.sendJson(res, 200, { success: true });
      }

      // /api/conversations/:id/read
      const convReadMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/read$/);
      if (convReadMatch && req.method === 'POST') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const conversationId = convReadMatch[1];
        await this.db.messages.markConversationRead(conversationId, currentUser.userId);
        return this.sendJson(res, 200, { success: true });
      }

      // /api/messages/:id (delete for everyone or for me)
      const msgDelMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
      if (msgDelMatch && req.method === 'DELETE') {
        if (!currentUser) return this.sendJson(res, 401, { error: 'Unauthorized' });
        const messageId = msgDelMatch[1];
        const { deleteForEveryone } = body || {};
        if (deleteForEveryone) {
          const success = await this.db.messages.deleteForEveryone(messageId, currentUser.userId);
          return this.sendJson(res, 200, { success });
        }
        return this.sendJson(res, 200, { success: true });
      }

      // Analytics Summary
      if (pathname === '/analytics/summary' && req.method === 'GET') {
        return this.sendJson(res, 200, this.analyticsService.getSummary());
      }

      // Not Found
      this.sendJson(res, 404, { error: 'Route not found' });
    } catch (err: any) {
      console.error('[HTTP ERROR]', err);
      this.sendJson(res, 500, { error: 'Internal server error occurred' });
    }
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', (err) => reject(err));
    });
  }
}
