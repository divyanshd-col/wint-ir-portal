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
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    const res = await pool.query(`
      SELECT 
        c.id AS chat_id,
        a.name AS agent_name,
        c.closed_at,
        i.reviewed_by,
        i.reviewed_at,
        i.iqs_score,
        i.model_version,
        c.conversation_type,
        c.tags->>'disposition' AS disposition
      FROM iqs_scores i
      JOIN conversations c ON c.id = i.chat_id
      LEFT JOIN agents a ON a.id = c.agent_id
      WHERE i.reviewed_by IS NOT NULL AND i.reviewed_by != ''
        AND c.closed_at >= '2026-06-15'
        AND (i.parameters->'__scores' IS NOT NULL OR i.parameters->'__agent_parameters' IS NOT NULL OR i.model_version ILIKE '%gemini-3%')
      ORDER BY c.closed_at DESC
    `);

    const humanChats = res.rows.filter(r => r.agent_name && r.agent_name !== 'Robylon AI' && r.conversation_type !== 'bot');
    const botChats = res.rows.filter(r => !r.agent_name || r.agent_name === 'Robylon AI' || r.conversation_type === 'bot');

    console.log(`Human Agent v4 Reviewed Chats (${humanChats.length} total):`);
    console.log(JSON.stringify(humanChats.slice(0, 15), null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
