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

let conn = 'postgresql://neondb_owner:npg_6cqMlJ7OTkEg@ep-aged-bonus-b4oq4i1b-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/DATABASE_URL="?([^"\n\r]+)"?/);
  if (match) conn = match[1];
} catch {}

async function main() {
  const pool = new pg.Pool({ connectionString: conn });
  try {
    const tables = ['devices', 'trusted_devices', 'conversations', 'messages', 'transfer_sessions'];
    for (const t of tables) {
      const res = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position;
      `, [t]);
      console.log(`\nTable '${t}':`);
      for (const r of res.rows) {
        console.log(`  - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`);
      }
    }
  } catch (err) {
    console.error('Error querying Neon:', err);
  } finally {
    await pool.end();
  }
}

main();
