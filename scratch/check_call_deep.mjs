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
    // 1. Check conversations schema
    const convCols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conversations'`);
    console.log('conversations columns:', convCols.rows.map(r => r.column_name).join(', '));

    // 2. Check contacts schema
    const contCols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'contacts'`);
    console.log('contacts columns:', contCols.rows.map(r => r.column_name).join(', '));

    // 3. Search conversation for contact_id 36733
    const convs = await pool.query(`SELECT * FROM conversations WHERE contact_id = '36733' LIMIT 5`);
    console.log('conversations for 36733 count:', convs.rows.length);
    if (convs.rows.length > 0) {
      console.log('first conv:', convs.rows[0]);
    }

    // 4. Search contacts by phone
    const contactsPhone = await pool.query(`SELECT * FROM contacts WHERE phone LIKE '%9232178490%' OR id = '36733'`);
    console.log('contacts matching:', contactsPhone.rows);

    // 5. Check Dhanush's calls
    const dhanushCalls = await pool.query(`
      SELECT id, chat_id, agent_id, status, called_at, call_disposition 
      FROM call_recordings 
      WHERE agent_id = 8 
      ORDER BY called_at DESC 
      LIMIT 10
    `);
    console.log('Recent calls for Dhanush (agent_id = 8):', dhanushCalls.rows);

    // 6. Check call_recordings count by status for Dhanush
    const countCr = await pool.query(`SELECT status, count(*) FROM call_recordings WHERE agent_id = 8 GROUP BY status`);
    console.log('Call recordings count by status for Dhanush:', countCr.rows);

    // 7. Check call_evaluations count for Dhanush
    const countCe = await pool.query(`SELECT count(*) FROM call_evaluations WHERE agent_id = 8`);
    console.log('Call evaluations count for Dhanush:', countCe.rows[0]);

    // 8. Check all call_evaluations for Dhanush
    const dhanushEvals = await pool.query(`
      SELECT ce.call_id, ce.chat_id, ce.agent_id, ce.verdict, ce.iqs_percent, ce.status, ce.scored_at
      FROM call_evaluations ce
      WHERE ce.agent_id = 8
      ORDER BY ce.scored_at DESC
      LIMIT 5
    `);
    console.log('Recent call evaluations for Dhanush:', dhanushEvals.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

run();
