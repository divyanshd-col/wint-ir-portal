#!/usr/bin/env node
/**
 * backfill-dispositions.mjs
 *
 * Reads an Excel file with Chat ID / Disposition / Sub-disposition columns and
 * POSTs them to /api/admin/backfill-dispositions in batches of 200.
 *
 * Usage:
 *   node scripts/backfill-dispositions.mjs <excel-file> <base-url> <session-cookie>
 *   node scripts/backfill-dispositions.mjs <excel-file> <base-url> <session-cookie> --dry-run
 *
 * Arguments:
 *   excel-file      Path to the .xlsx / .xls file
 *   base-url        Portal base URL, e.g. https://wint-ir-portal.vercel.app
 *   session-cookie  Value of the next-auth.session-token cookie (get from browser DevTools)
 *
 * Flags:
 *   --dry-run       Parse and preview rows without writing to DB
 *
 * Column detection (case-insensitive, partial match):
 *   "chat id"   → chatId
 *   "disposition" (not sub) → disposition
 *   "sub" or "sub_disposition" or "sub-disposition" → subDisposition
 *
 * Example:
 *   node scripts/backfill-dispositions.mjs ~/Downloads/chats.xlsx \
 *     https://wint-ir-portal.vercel.app \
 *     "eyJhbGci..." --dry-run
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--dry-run');
const isDryRun = process.argv.includes('--dry-run');

const [excelPath, baseUrl, sessionCookie] = args;

if (!excelPath || !baseUrl) {
  console.error('Usage: node scripts/backfill-dispositions.mjs <excel-file> <base-url> [session-cookie] [--dry-run]');
  process.exit(1);
}

if (!isDryRun && !sessionCookie) {
  console.error('Error: session-cookie is required unless using --dry-run');
  process.exit(1);
}

// ── Parse Excel ───────────────────────────────────────────────────────────────
console.log(`\nReading: ${excelPath}`);

let workbook;
try {
  workbook = XLSX.readFile(excelPath);
} catch (err) {
  console.error(`Failed to read file: ${err.message}`);
  process.exit(1);
}

const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

if (!rawRows.length) {
  console.error('No rows found in sheet:', sheetName);
  process.exit(1);
}

console.log(`Sheet: "${sheetName}" — ${rawRows.length} rows`);

// Detect column names
const headers = Object.keys(rawRows[0]);
console.log('Headers detected:', headers.join(' | '));

function findHeader(predicate) {
  return headers.find(h => predicate(h.toLowerCase().trim()));
}

const chatIdCol = findHeader(h => h.includes('chat') && h.includes('id'));
const dispCol = findHeader(h => h.includes('disposition') && !h.includes('sub'));
const subDispCol = findHeader(h => h.includes('sub'));

if (!chatIdCol) {
  console.error('Could not find a "Chat ID" column. Headers:', headers);
  process.exit(1);
}
if (!dispCol) {
  console.error('Could not find a "Disposition" column. Headers:', headers);
  process.exit(1);
}

console.log(`\nColumn mapping:`);
console.log(`  Chat ID        → "${chatIdCol}"`);
console.log(`  Disposition    → "${dispCol}"`);
console.log(`  Sub-disposition → ${subDispCol ? `"${subDispCol}"` : '(none — will use empty string)'}`);

// Build rows
const rows = [];
let skipped = 0;

for (const raw of rawRows) {
  const chatId = String(raw[chatIdCol] ?? '').trim();
  const disposition = String(raw[dispCol] ?? '').trim();
  const subDisposition = subDispCol ? String(raw[subDispCol] ?? '').trim() : '';

  if (!chatId || !disposition) {
    skipped++;
    continue;
  }

  rows.push({ chatId, disposition, subDisposition });
}

console.log(`\nParsed: ${rows.length} rows (${skipped} skipped — missing chatId or disposition)`);

if (isDryRun) {
  console.log('\n── DRY RUN — first 20 rows ──────────────────────────────────────');
  rows.slice(0, 20).forEach((r, i) => {
    console.log(`  ${i + 1}. chatId=${r.chatId}  disp="${r.disposition}"  sub="${r.subDisposition}"`);
  });
  if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
  console.log('\nDry run complete — no changes written.');
  process.exit(0);
}

// ── Send in batches ───────────────────────────────────────────────────────────
const BATCH_SIZE = 200;
const endpoint = `${baseUrl.replace(/\/$/, '')}/api/admin/backfill-dispositions`;

console.log(`\nSending to: ${endpoint}`);
console.log(`Batch size: ${BATCH_SIZE}`);
console.log('');

let totalUpdated = 0;
let totalErrors = 0;

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  process.stdout.write(`Batch ${batchNum}/${totalBatches} (rows ${i + 1}–${i + batch.length})... `);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `next-auth.session-token=${sessionCookie}`,
      },
      body: JSON.stringify({ rows: batch }),
    });
  } catch (err) {
    console.error(`\nNetwork error: ${err.message}`);
    process.exit(1);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`\nInvalid response (status ${res.status})`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`\nAPI error (${res.status}): ${data.error || JSON.stringify(data)}`);
    process.exit(1);
  }

  totalUpdated += data.updated ?? 0;
  totalErrors  += (data.errors ?? []).length;

  console.log(`✓ updated=${data.updated}  notFound=${data.notFound ?? 0}  errors=${(data.errors ?? []).length}`);

  if (data.errors?.length) {
    data.errors.forEach(e => console.log(`  ⚠ ${e}`));
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Done.  Total updated: ${totalUpdated}  |  Total errors: ${totalErrors}`);
