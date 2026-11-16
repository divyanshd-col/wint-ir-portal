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
    console.log('Running Migration 038 (pcg_rm_directory)...');
    const sql038 = readFileSync(join(ROOT, 'db/migrations/038_pcg_rm_directory.sql'), 'utf-8');
    await pool.query(sql038);
    console.log('✅ 038_pcg_rm_directory applied successfully.');

    console.log('Running Migration 039 (pcg_chat_evaluations)...');
    const sql039 = readFileSync(join(ROOT, 'db/migrations/039_pcg_chat_evaluations.sql'), 'utf-8');
    await pool.query(sql039);
    console.log('✅ 039_pcg_chat_evaluations applied successfully.');

    const res = await pool.query('SELECT count(*) FROM pcg_rm_directory');
    console.log(`Directory row count: ${res.rows[0].count}`);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
