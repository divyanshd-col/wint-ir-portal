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
    console.log('--- Checking all conversations for contact 36733 ---');
    const convs = await pool.query(`
      SELECT id, contact_id, agent_id, started_at, closed_at, created_at, tags, webhook_trigger
      FROM conversations 
      WHERE contact_id = '36733'
      ORDER BY created_at DESC
    `);
    console.log('Conversations count:', convs.rows.length);
    console.log(convs.rows);

    console.log('--- Checking conversations around 2026-10-07 for agent 8 (Dhanush) ---');
    const dhanushConvs = await pool.query(`
      SELECT id, contact_id, agent_id, started_at, closed_at, created_at, tags
      FROM conversations
      WHERE agent_id = 8 AND created_at >= '2026-10-07 00:00:00'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('Dhanush conversations on 2026-10-07:', dhanushConvs.rows);

    console.log('--- Checking webhook payloads for call 169678 or phone 919232178490 ---');
    const payloads = await pool.query(`
      SELECT id, source, event_type, chat_id, created_at 
      FROM robylon_webhook_payloads 
      WHERE chat_id = '169678' OR payload::text LIKE '%169678%' OR payload::text LIKE '%919232178490%'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('Webhook payloads:', payloads.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

run();
