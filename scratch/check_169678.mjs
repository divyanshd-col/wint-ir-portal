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
    // 1. Search for call_recordings with id or call_id 169678
    console.log('--- Checking call_recordings ---');
    const crRes = await pool.query(`
      SELECT * FROM call_recordings 
      WHERE id = '169678' OR id LIKE '%169678%'
    `);
    console.log('call_recordings rows:', crRes.rows);

    // 2. Check pcg_call_recordings if exists
    console.log('--- Checking pcg_call_recordings ---');
    try {
      const pcgRes = await pool.query(`
        SELECT * FROM pcg_call_recordings 
        WHERE id = '169678' OR call_id = '169678' OR call_id LIKE '%169678%'
      `);
      console.log('pcg_call_recordings rows:', pcgRes.rows);
    } catch (e) {
      console.log('pcg_call_recordings error:', e.message);
    }

    // 3. Search in all tables with columns matching '169678'
    console.log('--- Searching tables ---');
    const tables = await pool.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND (column_name ILIKE '%call%' OR column_name ILIKE '%id%')
    `);
    
    // Check call_evaluations
    try {
      const ceRes = await pool.query(`SELECT * FROM call_evaluations WHERE call_id = '169678' OR call_id LIKE '%169678%'`);
      console.log('call_evaluations rows:', ceRes.rows);
    } catch(e) {
      console.log('call_evaluations error:', e.message);
    }

    // 4. Check agent Dhanush
    console.log('--- Checking Dhanush in agents/users ---');
    const agentRes = await pool.query(`
      SELECT * FROM agents WHERE name ILIKE '%dhanush%'
    `);
    console.log('agents matching dhanush:', agentRes.rows);

    const usersRes = await pool.query(`
      SELECT id, name, email, role FROM users WHERE name ILIKE '%dhanush%' OR email ILIKE '%dhanush%'
    `);
    console.log('users matching dhanush:', usersRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

run();
