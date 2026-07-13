import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
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

try {
  const statusRes = await pool.query(`
    SELECT status, COUNT(*) as count 
    FROM call_recordings 
    GROUP BY status
  `);
  console.log('Call recordings by status:');
  console.table(statusRes.rows);

  const totalRes = await pool.query('SELECT COUNT(*) as count FROM call_recordings');
  console.log(`Total call recordings: ${totalRes.rows[0].count}`);

  const evalRes = await pool.query('SELECT COUNT(*) as count FROM call_evaluations');
  console.log(`Total call evaluations: ${evalRes.rows[0].count}`);
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await pool.end();
}
