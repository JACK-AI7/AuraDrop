import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';

export interface UserTokenPayload {
  userId: string;
  username: string;
  email: string;
  deviceId?: string;
}

export class AuthService {
  private secretKey: string;

  constructor() {
    this.secretKey = process.env.JWT_SECRET || 'auradrop-secure-production-jwt-key-2026';
  }

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateAccessToken(payload: UserTokenPayload, expiresInSeconds: number = 900): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const claims = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${header}.${claims}`)
      .digest('base64url');
    return `${header}.${claims}.${signature}`;
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = `rt_${crypto.randomBytes(32).toString('hex')}`;
    const hash = this.hashToken(token);
    return { token, hash };
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  verifyAccessToken(token: string): UserTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, claims, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(`${header}.${claims}`)
        .digest('base64url');
      if (signature !== expectedSignature) return null;

      const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
      if (payload.exp && Date.now() / 1000 > payload.exp) return null; // Expired
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Generates coturn ephemeral HMAC-SHA1 credentials (Section 12)
   */
  generateTurnCredentials(usernamePrefix = 'auradrop', ttlSeconds = 86400): {
    username: string;
    credential: string;
    urls: string[];
    ttl: number;
  } {
    const secret = process.env.TURN_SECRET || 'auradrop-production-coturn-shared-secret-2026';
    const turnHost = process.env.TURN_HOST || 'turn.auradrop.network';
    const turnPort = parseInt(process.env.TURN_PORT || '3478', 10);
    const turnsPort = parseInt(process.env.TURNS_PORT || '5349', 10);

    const expiryTime = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiryTime}:${usernamePrefix}`;

    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(username);
    const credential = hmac.digest('base64');

    return {
      username,
      credential,
      ttl: ttlSeconds,
      urls: [
        `stun:${turnHost}:${turnPort}`,
        `turn:${turnHost}:${turnPort}?transport=udp`,
        `turn:${turnHost}:${turnPort}?transport=tcp`,
        `turns:${turnHost}:${turnsPort}?transport=tcp`,
      ],
    };
  }
}
