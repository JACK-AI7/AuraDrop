import pg from 'pg';
import fs from 'node:fs';
import dns from 'node:dns';

// Ensure IPv4 lookup priority
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
} catch {}

let conn = process.env.DATABASE_URL || '';
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/DATABASE_URL="?([^"\n\r]+)"?/);
  if (match) conn = match[1];
} catch {}

async function runMigration() {
  const pool = new pg.Pool({ connectionString: conn });
  try {
    const sql = fs.readFileSync('packages/database/migrations/003_v25_production_schema.sql', 'utf8');
    console.log('[Migration] Applying 003_v25_production_schema.sql to Neon...');
    await pool.query(sql);
    console.log('✅ Successfully applied 003_v25_production_schema.sql to Neon!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
