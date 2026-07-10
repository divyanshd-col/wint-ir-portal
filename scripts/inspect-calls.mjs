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

try {
  const linkedWithTranscript = await pool.query(`
    SELECT COUNT(*) as count 
    FROM call_recordings 
    WHERE status = 'linked' AND transcript IS NOT NULL
  `);
  console.log('Linked calls with transcript:', linkedWithTranscript.rows[0].count);

  const linkedWithoutTranscript = await pool.query(`
    SELECT COUNT(*) as count 
    FROM call_recordings 
    WHERE status = 'linked' AND transcript IS NULL
  `);
  console.log('Linked calls WITHOUT transcript:', linkedWithoutTranscript.rows[0].count);

} catch (err) {
  console.error('❌ Error:', err.message);
} finally {
  await pool.end();
}
