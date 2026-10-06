import * as crypto from 'node:crypto';

export interface UserTokenPayload {
  userId: string;
  username: string;
  email: string;
}

export class AuthService {
  private secretKey: string;

  constructor() {
    this.secretKey = process.env.JWT_SECRET || 'auradrop-secure-production-jwt-key-2026';
  }

  generateToken(payload: UserTokenPayload, expiresInHours: number = 24): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    const claims = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${header}.${claims}`)
      .digest('base64url');
    return `${header}.${claims}.${signature}`;
  }

  verifyToken(token: string): UserTokenPayload | null {
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
}
