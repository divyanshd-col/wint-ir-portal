import './_load-env';
import { query } from '../lib/cx/db';
import { runPcgCallPipeline, resolvePcgAgent, PCG_QUALITY_PARAMETERS } from '../lib/scoring/pcg-pipeline';

// Parse command line arguments
// e.g. npx tsx scripts/batch-evaluate-pcg.ts --limit=50 --from=2026-10-17 --min-duration=20
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const fromArg = args.find(a => a.startsWith('--from='));
const minDurationArg = args.find(a => a.startsWith('--min-duration='));
const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
const forceArg = args.includes('--force');
const retranscribeArg = args.includes('--retranscribe');
const allArg = args.includes('--all');

const FROM_DATE = fromArg ? fromArg.split('=')[1] : '2026-10-17 00:00:00+00';
const MIN_DURATION = minDurationArg ? parseInt(minDurationArg.split('=')[1], 10) : 20;
const LIMIT = allArg ? 1000 : (limitArg ? parseInt(limitArg.split('=')[1], 10) : 25);
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 6;

async function syncShortCalls(fromDate: string, minDuration: number) {
  console.log('⚡ Checking short / unrecorded calls (<20s) to mark as NOT_SCOREABLE without LLM cost...');
  
  const shortCalls = await query(`
    SELECT r.call_id, r.called_by, r.user_phone, r.agent_name, r.duration_seconds, r.phone_number
    FROM pcg_call_recordings r
    LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
    WHERE (r.start_time >= $1 OR r.created_at >= $1)
      AND (r.duration_seconds < $2 OR r.recording_url IS NULL)
      AND e.call_id IS NULL
  `, [fromDate, minDuration]);

  if (!shortCalls.length) {
    console.log('   ✓ Zero short/unrecorded calls pending.\n');
    return 0;
  }

  console.log(`   Found ${shortCalls.length} short/unrecorded calls. Populating NOT_SCOREABLE...`);

  const emptyParams: Record<string, any> = {};
  PCG_QUALITY_PARAMETERS.forEach(p => {
    emptyParams[p.id] = { id: p.id, name: p.name, maxScore: p.weight, earnedScore: 0, status: 'NA', quote: 'Unanswered / Under 20s call' };
  });
  const emptyParamsJson = JSON.stringify(emptyParams);

  for (const c of shortCalls) {
    const { rm, tl } = resolvePcgAgent(c.called_by || c.agent_name || c);
    await query(`
      INSERT INTO pcg_call_evaluations (
        call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
        iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
        verdict, parameters, transcript_turns, compliance_tripwire, scored_at
      ) VALUES ($1, $2, $3, $4, 'support', $5, null, null, null, null, 0, 'NOT_SCOREABLE', $6, '[]'::jsonb, false, NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        verdict = 'NOT_SCOREABLE', scored_at = NOW()
    `, [c.call_id, rm, tl, c.phone_number, c.duration_seconds || 0, emptyParamsJson]);
  }

  console.log(`   ✓ Marked ${shortCalls.length} calls as NOT_SCOREABLE in pcg_call_evaluations.\n`);
  return shortCalls.length;
}

async function batchEvaluatePcg() {
  console.log('===========================================================');
  console.log('🚀 PCG Call Quality Batch Evaluation Pipeline');
  console.log('===========================================================');
  console.log(`From Date:      ${FROM_DATE}`);
  console.log(`Min Duration:   ${MIN_DURATION}s`);
  console.log(`Batch Limit:    ${LIMIT} calls`);
  console.log(`Concurrency:    ${CONCURRENCY} workers`);
  console.log(`Force Re-eval:  ${forceArg}`);
  console.log(`Re-transcribe:  ${retranscribeArg} (default: reuse existing transcripts)`);
  console.log('===========================================================\n');

  // Step 1: Pre-populate short/unrecorded calls
  await syncShortCalls(FROM_DATE, MIN_DURATION);

  // Step 2: Query candidate calls from Oct 17 onwards
  const calls = await query(`
    SELECT r.call_id, r.called_by, r.user_phone, r.agent_name, r.duration_seconds, r.start_time, r.recording_url
    FROM pcg_call_recordings r
    LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
    WHERE (r.start_time >= $1 OR r.created_at >= $1)
      AND r.duration_seconds >= $2
      AND r.recording_url IS NOT NULL
      AND (e.call_id IS NULL OR $3 = true)
    ORDER BY r.start_time ASC
    LIMIT $4
  `, [FROM_DATE, MIN_DURATION, forceArg, LIMIT]);

  console.log(`Found ${calls.length} candidate conversation calls to evaluate with Gemini.\n`);
  if (!calls.length) {
    console.log('🎉 All calls matching criteria have already been evaluated! Exiting.');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let tripwireCount = 0;
  const scores: number[] = [];

  let nextIndex = 0;
  async function worker(workerId: number) {
    while (nextIndex < calls.length) {
      const idx = nextIndex++;
      const call = calls[idx];
      const progress = `[${idx + 1}/${calls.length}] (W${workerId + 1})`;
      const callerName = call.called_by || call.agent_name || 'RM';
      const startMs = Date.now();

      try {
        const res = await runPcgCallPipeline(call.call_id, { forceTranscript: retranscribeArg });
        const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);

        if (res.verdict === 'NOT_SCOREABLE') {
          console.log(`   ⏭️  ${progress} Call ${call.call_id} Not scoreable (${durationSec}s)`);
        } else {
          const iqs = res.iqs ?? 0;
          scores.push(iqs);
          if (res.verdict === 'COMPLIANCE_BREACH') tripwireCount++;
          successCount++;

          console.log(`   ✅ ${progress} Call ${call.call_id} in ${durationSec}s | RM: ${res.rmName} (${res.tlName}) | IQS: ${iqs}% | Verdict: ${res.verdict}`);
          if (res.verdict === 'COMPLIANCE_BREACH') {
            console.log(`   ⚠️  COMPLIANCE TRIPWIRE TRIPPED on ${call.call_id}`);
          }
        }
      } catch (err: any) {
        failCount++;
        const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
        console.error(`   ❌ ${progress} Failed Call ${call.call_id} after ${durationSec}s:`, err.message || err);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, calls.length);
  const workers = Array.from({ length: workerCount }, (_, i) => worker(i));
  await Promise.all(workers);

  const avgIqs = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 'N/A';

  console.log('\n===========================================================');
  console.log('📊 Batch Evaluation Run Finished');
  console.log('===========================================================');
  console.log(`Evaluated:           ${successCount}/${calls.length}`);
  console.log(`Failed:              ${failCount}`);
  console.log(`Avg IQS:             ${avgIqs}%`);
  console.log(`Compliance Breaches: ${tripwireCount}`);
  console.log('===========================================================');
}

batchEvaluatePcg().then(() => process.exit(0)).catch(err => {
  console.error('Fatal batch runner error:', err);
  process.exit(1);
});
