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
  // 1. Show latest 10 evaluations
  const res = await pool.query(`
    SELECT call_id, scored_at, iqs_percent, verdict, gates_prompt_version, iqs_prompt_version
    FROM call_evaluations
    ORDER BY scored_at DESC
    LIMIT 10
  `);
  console.log('\nMost recent call evaluations:');
  console.table(res.rows);

  // 2. Count by version
  const verRes = await pool.query(`
    SELECT gates_prompt_version, COUNT(*) as count
    FROM call_evaluations
    GROUP BY gates_prompt_version
    ORDER BY count DESC
  `);
  console.log('\nCall evaluations by version:');
  console.table(verRes.rows);

  // 3. Count call recordings by status
  const statRes = await pool.query(`
    SELECT status, COUNT(*) as count
    FROM call_recordings
    GROUP BY status
    ORDER BY count DESC
  `);
  console.log('\nCall recordings by status:');
  console.table(statRes.rows);

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await pool.end();
}
