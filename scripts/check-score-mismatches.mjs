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
  console.log('--- Checking iqs_scores with iqs_score = 0 ---');
  const zeroScores = await pool.query(`
    SELECT s.chat_id, s.iqs_score, s.call_iqs_score, c.conversation_type, c.tags->>'disposition' as disposition, s.parameters
    FROM iqs_scores s
    LEFT JOIN conversations c ON c.id = s.chat_id
    WHERE s.iqs_score = 0
  `);
  console.log('Total iqs_score = 0 rows:', zeroScores.rows.length);
  for (const r of zeroScores.rows.slice(0, 10)) {
    const params = r.parameters || {};
    console.log(`Chat ${r.chat_id} [type: ${r.conversation_type}, dispo: ${r.disposition}]`);
    console.log('  __scores:', JSON.stringify(params.__scores));
    console.log('  sample params:', JSON.stringify(params).slice(0, 150));
  }

  console.log('\n--- Checking chats where parameters are all NA/NIL but iqs_score = 0 or vice versa ---');
  const allZeroOrNull = await pool.query(`
    SELECT s.chat_id, s.iqs_score, s.parameters
    FROM iqs_scores s
    WHERE s.iqs_score = 0 OR s.iqs_score IS NULL
    LIMIT 200
  `);
  
  let nilInBodyZeroAtTop = 0;
  let zeroInBodyNilAtTop = 0;

  for (const r of allZeroOrNull.rows) {
    const params = r.parameters || {};
    const agentParams = params.__agent_parameters || params;
    const botParams = params.__bot_parameters || params;
    
    // check if agent or bot params are all NA
    const checkAllNA = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      const keys = Object.keys(obj).filter(k => !k.startsWith('__'));
      if (keys.length === 0) return false;
      return keys.every(k => {
        const val = obj[k]?.score !== undefined ? obj[k].score : obj[k];
        return val === 'NA' || val === null || val === undefined;
      });
    };

    const isAllAgentNA = checkAllNA(agentParams);
    const isAllBotNA = checkAllNA(botParams);

    if ((isAllAgentNA || isAllBotNA) && r.iqs_score === 0) {
      nilInBodyZeroAtTop++;
      console.log(`[MISMATCH: all NA in body, but 0 in db column] Chat ${r.chat_id}`);
    }
  }
  console.log(`Total nil in body vs 0 in DB found: ${nilInBodyZeroAtTop}`);

  await pool.end();
}

run().catch(console.error);
