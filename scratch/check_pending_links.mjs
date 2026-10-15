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

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  try {
    const totalPendingLink = await pool.query(`
      SELECT count(*) FROM call_recordings WHERE status = 'pending_link'
    `);
    console.log('Total calls with status pending_link:', totalPendingLink.rows[0].count);

    const pendingLinkDhanush = await pool.query(`
      SELECT id, chat_id, agent_id, contact_id, called_at, duration_seconds, status, call_disposition, call_sub_disposition
      FROM call_recordings 
      WHERE agent_id = 8 AND status = 'pending_link'
      ORDER BY called_at DESC
    `);
    console.log('Dhanush pending_link calls count:', pendingLinkDhanush.rows.length);
    console.log('Dhanush pending_link calls:', pendingLinkDhanush.rows);

    const statusCounts = await pool.query(`
      SELECT status, count(*) FROM call_recordings GROUP BY status
    `);
    console.log('All call_recordings by status:', statusCounts.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

run();
