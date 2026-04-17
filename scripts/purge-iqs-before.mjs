#!/usr/bin/env node
/**
 * purge-iqs-before.mjs  —  Delete IQS score entries before a given date.
 *
 * Usage:
 *   node scripts/purge-iqs-before.mjs --before 2026-04-17          # dry-run (preview only)
 *   node scripts/purge-iqs-before.mjs --before 2026-04-17 --confirm # actually delete
 *
 * Also deletes the transcript keys (wint_t:{chatId}) for removed entries.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Load .env.local ───────────────────────────────────────────────────────────
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const URL   = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const IQS_KEY = 'wint_iqs_scores';
const BATCH   = 500;

if (!URL || !TOKEN) {
  console.error('❌  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.');
  process.exit(1);
}

// ── Args ──────────────────────────────────────────────────────────────────────
const beforeIdx = process.argv.indexOf('--before');
const cutoff    = beforeIdx >= 0 ? process.argv[beforeIdx + 1] : null;
const confirm   = process.argv.includes('--confirm');

if (!cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
  console.error('Usage: node scripts/purge-iqs-before.mjs --before YYYY-MM-DD [--confirm]');
  process.exit(1);
}

// ── Upstash helpers ───────────────────────────────────────────────────────────
async function upstash(cmd) {
  const res = await fetch(`${URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd]),
  });
  const data = await res.json();
  return data[0]?.result ?? null;
}

async function llen() {
  const res = await fetch(`${URL}/llen/${IQS_KEY}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store',
  });
  const data = await res.json();
  return typeof data.result === 'number' ? data.result : 0;
}

async function lrange(start, end) {
  const res = await fetch(`${URL}/lrange/${IQS_KEY}/${start}/${end}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store',
  });
  const data = await res.json();
  return Array.isArray(data.result) ? data.result : [];
}

async function delKey(key) {
  await upstash(['DEL', key]);
}

// ── Fetch all entries in batches ──────────────────────────────────────────────
async function fetchAll() {
  const total = await llen();
  if (total === 0) return [];
  const batches = Math.ceil(total / BATCH);
  const results = await Promise.all(
    Array.from({ length: batches }, (_, i) => lrange(i * BATCH, i * BATCH + BATCH - 1))
  );
  return results.flat();
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n  Cutoff date : ${cutoff}  (keep entries from ${cutoff} onwards)`);
console.log(`  Mode        : ${confirm ? '⚠️  LIVE DELETE' : '🔍 DRY RUN (pass --confirm to actually delete)'}\n`);

console.log('  Fetching all IQS entries from Upstash …');
const raw = await fetchAll();
console.log(`  Total entries found: ${raw.length}\n`);

const keep   = [];
const remove = [];

for (const r of raw) {
  try {
    const e = JSON.parse(r);
    const entryDate = (e.date || (e.scoredAt || '').slice(0, 10) || '');
    if (entryDate >= cutoff) {
      keep.push(e);
    } else {
      remove.push(e);
    }
  } catch {
    keep.push(JSON.parse(r ?? '{}')); // keep unparseable entries to be safe
  }
}

console.log(`  Entries to DELETE : ${remove.length}  (before ${cutoff})`);
console.log(`  Entries to KEEP   : ${keep.length}  (from ${cutoff} onwards)\n`);

if (remove.length > 0) {
  // Show a sample of what will be removed
  const sample = remove.slice(0, 10);
  console.log('  Sample of entries that will be deleted:');
  console.log('  ' + '─'.repeat(70));
  for (const e of sample) {
    console.log(`  ${(e.date || '?').padEnd(12)} ${(e.agentName || 'unknown').padEnd(20)} IQS:${String(e.iqs ?? '?').padEnd(5)} chat:${e.chatId || '?'}`);
  }
  if (remove.length > 10) console.log(`  … and ${remove.length - 10} more`);
  console.log('  ' + '─'.repeat(70) + '\n');
}

if (!confirm) {
  console.log('  ✅  Dry run complete. No data changed.');
  console.log('      Add --confirm to execute the deletion.\n');
  process.exit(0);
}

if (remove.length === 0) {
  console.log('  ✅  Nothing to delete — all entries are from ' + cutoff + ' or later.\n');
  process.exit(0);
}

// ── Delete the whole list, then re-push keepers ───────────────────────────────
console.log('  Deleting entire IQS list …');
await delKey(IQS_KEY);

if (keep.length > 0) {
  console.log(`  Re-inserting ${keep.length} entries …`);
  // LPUSH adds to the front, so push in reverse order to preserve newest-first ordering
  const keepsReversed = [...keep].reverse();
  // Push in batches of 50 to avoid oversized payloads
  const PUSH_BATCH = 50;
  for (let i = 0; i < keepsReversed.length; i += PUSH_BATCH) {
    const slice = keepsReversed.slice(i, i + PUSH_BATCH);
    const cmds = slice.map(e => ['LPUSH', IQS_KEY, JSON.stringify(e)]);
    await fetch(`${URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
  }
}

// ── Delete transcript keys for removed entries ────────────────────────────────
const transcriptIds = [...new Set(remove.map(e => e.chatId).filter(Boolean))];
if (transcriptIds.length > 0) {
  console.log(`  Deleting ${transcriptIds.length} transcript keys …`);
  const TDEL_BATCH = 50;
  for (let i = 0; i < transcriptIds.length; i += TDEL_BATCH) {
    const slice = transcriptIds.slice(i, i + TDEL_BATCH);
    const cmds = slice.map(id => ['DEL', `wint_t:${id}`]);
    await fetch(`${URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
  }
}

// ── Verify ────────────────────────────────────────────────────────────────────
const newCount = await llen();
console.log(`\n  ✅  Done!`);
console.log(`      Deleted  : ${remove.length} entries`);
console.log(`      Remaining: ${newCount} entries (from ${cutoff} onwards)\n`);
