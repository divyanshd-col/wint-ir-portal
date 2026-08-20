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
    const conv = await pool.query(`SELECT id, agent_id, conversation_type, closed_at FROM conversations WHERE id = '81234'`);
    console.log('CONVERSATION:', conv.rows[0]);

    const iqs = await pool.query(`SELECT * FROM iqs_scores WHERE chat_id = '81234'`);
    console.log('\nIQS_SCORES:', iqs.rows[0]);

    const flags = await pool.query(`SELECT * FROM iqs_flags WHERE chat_id = '81234'`);
    console.log('\nIQS_FLAGS:', flags.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
