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
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const chats = ['112148', '116470', '118002', '118072', '118797', '117247', '39799', '39889'];
  const res = await pool.query(`
    SELECT s.chat_id, s.iqs_score, s.call_iqs_score, c.conversation_type, c.tags->>'disposition' as disposition, s.parameters
    FROM iqs_scores s
    LEFT JOIN conversations c ON c.id = s.chat_id
    WHERE s.chat_id = ANY($1)
  `, [chats]);

  for (const r of res.rows) {
    console.log(`\n================= CHAT ${r.chat_id} [type: ${r.conversation_type}, dispo: ${r.disposition}, iqs_score: ${r.iqs_score}] =================`);
    console.log(JSON.stringify(r.parameters, null, 2));
  }

  await pool.end();
}

run().catch(console.error);
