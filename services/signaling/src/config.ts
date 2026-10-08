import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

// Force IPv4 lookup priority across Node.js environments to prevent IPv6 WAN timeouts
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

// Load local .env if available
function loadEnvFile() {
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), 'apps/backend/.env'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
          if (match && !process.env[match[1]]) {
            let val = match[2] || '';
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
            process.env[match[1]] = val;
          }
        }
      } catch {}
    }
  }
}

loadEnvFile();

export const config = {
  port: parseInt(process.env.PORT || '48280', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl:
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_6cqMlJ7OTkEg@ep-aged-bonus-b4oq4i1b-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  redisUrl: process.env.REDIS_URL || '',
  turnSecret: process.env.TURN_SECRET || 'auradrop-production-coturn-shared-secret-2026',
  turnHost: process.env.TURN_HOST || 'turn.auradrop.network',
  turnRealm: process.env.TURN_REALM || 'auradrop.network',
  publicSignalingWssUrl: process.env.PUBLIC_SIGNALING_WSS_URL || '',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  appId: process.env.AURADROP_APP_ID || 'auradrop-v25',
  instanceId: `sig_${process.pid}_${Math.random().toString(36).substring(2, 8)}`,
};
