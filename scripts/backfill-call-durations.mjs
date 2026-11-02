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
  console.error('❌ Missing POSTGRES_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

function extractDuration(transcript) {
  if (!transcript) return null;
  const parsed = typeof transcript === 'string' ? (() => { try { return JSON.parse(transcript); } catch { return null; } })() : transcript;
  if (!parsed) return null;
  const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
  if (!segments.length) return null;

  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (!s) continue;
    if (typeof s.end === 'number' && s.end > 0) return Math.round(s.end);
    if (s.ts && typeof s.ts === 'string') {
      const parts = s.ts.trim().split(':').map(Number);
      if (parts.every(n => !isNaN(n))) {
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    if (typeof s.start === 'number' && s.start > 0) return Math.round(s.start);
  }
  return null;
}

try {
  console.log('Querying call_recordings with missing duration...');
  const res = await pool.query(`
    SELECT id, transcript 
    FROM call_recordings 
    WHERE (duration_seconds IS NULL OR duration_seconds <= 0) AND transcript IS NOT NULL
  `);
  console.log(`Found ${res.rows.length} call recordings with transcript but no duration.`);

  let updated = 0;
  for (const r of res.rows) {
    const dur = extractDuration(r.transcript);
    if (dur && dur > 0) {
      await pool.query('UPDATE call_recordings SET duration_seconds = $1 WHERE id = $2', [dur, r.id]);
      updated++;
      if (updated % 100 === 0) {
        console.log(`Updated ${updated} / ${res.rows.length}...`);
      }
    }
  }

  console.log(`✅ Successfully backfilled duration_seconds for ${updated} call recordings!`);
} catch (err) {
  console.error('❌ Error during backfill:', err.message);
} finally {
  await pool.end();
}

