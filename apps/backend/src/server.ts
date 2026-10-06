import * as http from 'node:http';
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

  constructor() {
    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ server: this.server });
    this.wsGateway = new WebSocketGateway(this.wss, this.presenceService);
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Security Headers (Helmet-style)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      // Health / Status
      if (pathname === '/health' && req.method === 'GET') {
        this.sendJson(res, 200, { status: 'healthy', timestamp: Date.now(), service: 'AuraDrop-Backend' });
        return;
      }

      // Read Body for POST/PUT requests
      let body: any = {};
      if (req.method === 'POST' || req.method === 'PUT') {
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

      // /auth/login & /auth/register
      if (pathname === '/auth/register' && req.method === 'POST') {
        const { username, displayName, email } = body;
        if (!username || !email) {
          return this.sendJson(res, 400, { error: 'Username and email are required' });
        }
        const user = await this.usersService.createUser(username, displayName || username, email);
        const token = this.authService.generateToken({
          userId: user.id,
          username: user.username,
          email: user.email,
        });
        return this.sendJson(res, 201, { user, token });
      }

      // /devices/register
      if (pathname === '/devices/register' && req.method === 'POST') {
        const { userId, deviceName, platform, publicKey, visibilityMode } = body;
        if (!deviceName || !platform || !publicKey) {
          return this.sendJson(res, 400, { error: 'deviceName, platform, and publicKey are required' });
        }
        const device = await this.devicesService.registerDevice(
          userId || null,
          deviceName,
          platform,
          publicKey,
          visibilityMode || 'everyone'
        );
        return this.sendJson(res, 201, { device });
      }

      // /presence/active
      if (pathname === '/presence/active' && req.method === 'GET') {
        const activeIds = this.presenceService.getActiveDeviceIds();
        return this.sendJson(res, 200, { activeDevices: activeIds });
      }

      // /pairing/create
      if (pathname === '/pairing/create' && req.method === 'POST') {
        const { initiatorDeviceId, receiverDeviceId, pairingMethod } = body;
        const pairing = this.pairingService.createPairing(
          initiatorDeviceId,
          receiverDeviceId,
          pairingMethod || 'qr'
        );
        return this.sendJson(res, 201, { pairing });
      }

      // /transfer-metadata/start
      if (pathname === '/transfer-metadata/start' && req.method === 'POST') {
        const { transferId, senderDeviceId, receiverDeviceId, totalFiles, totalBytes, files } = body;
        const record = this.transferMetadataService.recordTransferStart(
          transferId,
          senderDeviceId,
          receiverDeviceId,
          totalFiles,
          totalBytes,
          files || []
        );
        return this.sendJson(res, 201, {
          transferId: record.id,
          status: record.status,
          totalBytes: record.totalBytes.toString(),
        });
      }

      // /transfer-metadata/update
      if (pathname === '/transfer-metadata/update' && req.method === 'POST') {
        const { transferId, status, transferredBytes } = body;
        this.transferMetadataService.updateTransferStatus(transferId, status, transferredBytes);
        return this.sendJson(res, 200, { success: true });
      }

      // /settings
      if (pathname.startsWith('/settings') && req.method === 'GET') {
        const userId = url.searchParams.get('userId') || 'guest';
        const settings = this.settingsService.getSettings(userId);
        return this.sendJson(res, 200, { settings });
      }

      // /analytics/summary
      if (pathname === '/analytics/summary' && req.method === 'GET') {
        return this.sendJson(res, 200, this.analyticsService.getSummary());
      }

      // Not Found
      this.sendJson(res, 404, { error: 'Route not found' });
    } catch (err: any) {
      // Safe error response - never expose stack trace
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
        if (body.length > 2 * 1024 * 1024) {
          // 2MB payload limit
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', (err) => reject(err));
    });
  }
}
