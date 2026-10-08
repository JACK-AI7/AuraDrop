import crypto from 'node:crypto';
import { config } from '../config.js';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TurnCredentialsResponse {
  iceServers: IceServerConfig[];
  username: string;
  credential: string;
  expiration: number;
  ttl: number;
}

/**
 * Section 11: Dynamic Short-Lived COTURN Credentials (HMAC-SHA1)
 * Secret stays strictly server-side.
 */
export function generateTurnCredentials(deviceId: string, ttlSeconds = 86400): TurnCredentialsResponse {
  const expiration = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiration}:${deviceId}`;

  const hmac = crypto.createHmac('sha1', config.turnSecret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  const turnHost = config.turnHost;

  const iceServers: IceServerConfig[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        `stun:${turnHost}:3478`,
      ],
    },
    {
      urls: [
        `turn:${turnHost}:3478?transport=udp`,
        `turn:${turnHost}:3478?transport=tcp`,
        `turn:${turnHost}:5349?transport=tcp`,
      ],
      username,
      credential,
    },
  ];

  return {
    iceServers,
    username,
    credential,
    expiration,
    ttl: ttlSeconds,
  };
}
