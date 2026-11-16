import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

for (const fname of ['.env.local', '.env']) {
  const envFile = join(ROOT, fname);
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
      const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('❌ Missing POSTGRES_URL or POSTGRES_URL_NON_POOLING');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  try {
    console.log('Running Migration 040 (pcg_conversations_session_pk)...');
    const sql040 = readFileSync(join(ROOT, 'db/migrations/040_pcg_conversations_session_pk.sql'), 'utf-8');
    await pool.query(sql040);
    console.log('✅ 040_pcg_conversations_session_pk applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

