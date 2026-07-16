import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

// ── Load Environment Variables ──────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

// Ensure NODE_ENV is set so SSL matches the local env (ssl=false)
// (handled automatically by env context)

// ── Parse CLI Arguments ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const forceTranscript = args.includes('--force-transcript');

let limit: number | null = null;
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  limit = parseInt(args[limitIdx + 1], 10);
}

let delayMs = 1500; // default 1.5s delay to avoid hitting rate limits
const delayIdx = args.indexOf('--delay');
if (delayIdx !== -1 && args[delayIdx + 1]) {
  delayMs = parseInt(args[delayIdx + 1], 10);
}

let statusFilter = 'scored'; // Default to rerun scored calls since those are the ones we want to update
const statusIdx = args.indexOf('--status');
if (statusIdx !== -1 && args[statusIdx + 1]) {
  statusFilter = args[statusIdx + 1];
}

let fromDate: string | null = null;
const fromDateIdx = args.indexOf('--from-date');
if (fromDateIdx !== -1 && args[fromDateIdx + 1]) {
  fromDate = args[fromDateIdx + 1];
}

let callIdFilter: string | null = null;
const callIdIdx = args.indexOf('--call-id');
if (callIdIdx !== -1 && args[callIdIdx + 1]) {
  callIdFilter = args[callIdIdx + 1];
}

async function main() {
  console.log('🚀 Starting Call Analysis Rerun Script');
  console.log(`- Status Filter: ${statusFilter}`);
  console.log(`- Call ID Filter: ${callIdFilter !== null ? callIdFilter : 'No Call ID Filter'}`);
  console.log(`- From Date: ${fromDate !== null ? fromDate : 'No Date Cutoff'}`);
  console.log(`- Force Transcript: ${forceTranscript ? 'YES' : 'NO'}`);
  console.log(`- Limit: ${limit !== null ? limit : 'No Limit'}`);
  console.log(`- Delay: ${delayMs}ms between runs`);
  console.log(`- Dry Run: ${dryRun ? 'YES (No changes will be executed)' : 'NO'}`);
  console.log('──────────────────────────────────────────────────');

  let sql = `
    SELECT id, status, chat_id, called_at 
    FROM call_recordings 
  `;
  const params: any[] = [];
  const clauses: string[] = [];

  if (statusFilter !== 'all' && !callIdFilter) {
    if (statusFilter === 'failed') {
      clauses.push(`status LIKE 'failed_%'`);
    } else {
      clauses.push(`status = $${params.length + 1}`);
      params.push(statusFilter);
    }
  }

  if (fromDate) {
    clauses.push(`called_at >= $${params.length + 1}`);
    params.push(fromDate);
  }

  if (callIdFilter) {
    clauses.push(`id = $${params.length + 1}`);
    params.push(callIdFilter);
  }

  if (clauses.length > 0) {
    sql += ` WHERE ` + clauses.join(' AND ');
  }

  sql += ` ORDER BY called_at DESC `;

  if (limit !== null) {
    sql += ` LIMIT $${params.length + 1} `;
    params.push(limit);
  }

  const calls = await query(sql, params);
  console.log(`Found ${calls.length} calls matching filter.`);

  if (calls.length === 0) {
    console.log('No calls to process.');
    return;
  }

  if (dryRun) {
    console.log('\nList of call IDs matching criteria (Dry Run):');
    calls.forEach((c, idx) => {
      console.log(`[${idx + 1}] ID: ${c.id} | Status: ${c.status} | Chat: ${c.chat_id} | Date: ${c.called_at}`);
    });
    console.log('\n✅ Dry run completed.');
    return;
  }

  console.log('\nRunning evaluations...');
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    console.log(`\n[${i + 1}/${calls.length}] Processing Call ID: ${call.id} (Status: ${call.status})`);
    
    const startTime = Date.now();
    try {
      const result = await runCallPipeline(call.id, { forceTranscript });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Success | IQS: ${result.iqs}% | Verdict: ${result.verdict} | Time: ${elapsed}s`);
      successCount++;
    } catch (err: any) {
      console.error(`❌ Failed processing call ${call.id}:`, err.message);
      failCount++;
    }

    if (i < calls.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log('📊 Execution Summary:');
  console.log(`- Total Checked: ${calls.length}`);
  console.log(`- Successfully Evaluated: ${successCount}`);
  console.log(`- Failed: ${failCount}`);
  console.log('──────────────────────────────────────────────────');
}

main().catch(err => {
  console.error('Fatal error during rerun:', err);
  process.exit(1);
});
