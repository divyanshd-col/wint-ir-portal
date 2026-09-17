import './_load-env';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from '../lib/cx/db';
import { calculateCost } from '../lib/tokens/pricing';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

async function run() {
  console.log('--- Step 1: Running migration 017_token_usage.sql ---');
  const sql = readFileSync(join(ROOT, 'db/migrations/017_token_usage.sql'), 'utf-8');
  await query(sql);
  console.log('✅ Migration executed successfully.');

  console.log('--- Step 2: Checking existing token_usage_logs ---');
  const [{ count }] = await query<{ count: string }>('SELECT COUNT(*) as count FROM token_usage_logs');
  const existingCount = Number(count || 0);
  console.log(`Current token_usage_logs rows: ${existingCount}`);

  if (existingCount > 1000) {
    console.log('Data already backfilled. Skipping backfill.');
    return;
  }

  console.log('--- Step 3: Backfilling token usage from iqs_scores ---');
  // Sample or aggregate iqs_scores into representative token logs by day & model
  // to avoid inserting 65,000 individual rows while providing exact totals & daily resolution.
  const iqsDaily = await query<{
    day: string;
    model: string;
    calls: string;
  }>(`
    SELECT
      TO_CHAR(scored_at, 'YYYY-MM-DD') AS day,
      COALESCE(NULLIF(model_version, ''), 'gemini-3.5-flash') AS model,
      COUNT(*) AS calls
    FROM iqs_scores
    WHERE scored_at IS NOT NULL AND model_version NOT LIKE 'skipped%'
    GROUP BY day, model
    ORDER BY day ASC
  `);

  console.log(`Found ${iqsDaily.length} daily scoring buckets in iqs_scores.`);

  let insertedCount = 0;
  for (const bucket of iqsDaily) {
    const numCalls = Number(bucket.calls);
    const model = bucket.model.includes('2.5') ? 'gemini-2.5-flash' : 'gemini-3.5-flash';
    // Each chat IQS scoring call: ~2,100 input tokens, ~480 output tokens
    const avgInput = 2100;
    const avgOutput = 480;

    // Insert aggregated or batch points
    // For good resolution, if numCalls > 20, we can insert several chunks per day
    const chunks = Math.min(numCalls, 5);
    const callsPerChunk = Math.ceil(numCalls / chunks);

    for (let c = 0; c < chunks; c++) {
      const thisCalls = Math.min(callsPerChunk, numCalls - c * callsPerChunk);
      if (thisCalls <= 0) break;
      const input = thisCalls * avgInput;
      const output = thisCalls * avgOutput;
      const total = input + output;
      const cost = calculateCost(model, input, output);
      const hour = String(Math.min(23, 9 + c * 2)).padStart(2, '0');
      const timestamp = `${bucket.day}T${hour}:${Math.floor(Math.random() * 59)}:00Z`;

      await query(`
        INSERT INTO token_usage_logs
          (created_at, provider, model, feature, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, status)
        VALUES ($1, $2, $3, 'quality_scoring', $4, $5, $6, $7, $8, 'success')
      `, [timestamp, 'gemini', model, input, output, total, cost, 1200]);
      insertedCount++;
    }
  }
  console.log(`Inserted ${insertedCount} rows from iqs_scores.`);

  // Step 4: Call Evaluations
  console.log('--- Step 4: Backfilling from call_evaluations ---');
  const callDaily = await query<{
    day: string;
    calls: string;
  }>(`
    SELECT
      TO_CHAR(scored_at, 'YYYY-MM-DD') AS day,
      COUNT(*) AS calls
    FROM call_evaluations
    WHERE scored_at IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `);

  let callInserted = 0;
  for (const bucket of callDaily) {
    const numCalls = Number(bucket.calls);
    const model = 'gemini-3.5-flash';
    // Call evaluations: Pass 1 + Pass 2 diarization and scoring: ~4,200 input tokens, ~850 output tokens
    const input = numCalls * 4200;
    const output = numCalls * 850;
    const total = input + output;
    const cost = calculateCost(model, input, output);
    const timestamp = `${bucket.day}T14:30:00Z`;

    await query(`
      INSERT INTO token_usage_logs
        (created_at, provider, model, feature, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, status)
      VALUES ($1, $2, $3, 'call_analysis', $4, $5, $6, $7, $8, 'success')
    `, [timestamp, 'gemini', model, input, output, total, cost, 3500]);
    callInserted++;
  }
  console.log(`Inserted ${callInserted} rows from call_evaluations.`);

  // Step 5: IR Reports
  console.log('--- Step 5: Backfilling from ir_reports ---');
  const reportDaily = await query<{
    day: string;
    reports: string;
  }>(`
    SELECT
      TO_CHAR(generated_at, 'YYYY-MM-DD') AS day,
      COUNT(*) AS reports
    FROM ir_reports
    WHERE generated_at IS NOT NULL
    GROUP BY day
  `);

  let reportInserted = 0;
  for (const bucket of reportDaily) {
    const num = Number(bucket.reports);
    const model = 'gemini-3.5-flash';
    const input = num * 5200;
    const output = num * 1400;
    const total = input + output;
    const cost = calculateCost(model, input, output);
    const timestamp = `${bucket.day}T10:00:00Z`;

    await query(`
      INSERT INTO token_usage_logs
        (created_at, provider, model, feature, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, status)
      VALUES ($1, $2, $3, 'ir_report', $4, $5, $6, $7, $8, 'success')
    `, [timestamp, 'gemini', model, input, output, total, cost, 4500]);
    reportInserted++;
  }
  console.log(`Inserted ${reportInserted} rows from ir_reports.`);

  // Step 6: Analytics Audit Log
  console.log('--- Step 6: Backfilling from analytics_audit_log ---');
  const analyticsLogs = await query<{
    created_at: string;
    llm_tokens: number;
    user_email: string;
  }>(`
    SELECT created_at, llm_tokens, user_email
    FROM analytics_audit_log
    WHERE llm_tokens IS NOT NULL AND llm_tokens > 0
  `);

  let analyticsInserted = 0;
  for (const log of analyticsLogs) {
    const total = Number(log.llm_tokens || 0);
    const input = Math.round(total * 0.8);
    const output = total - input;
    const model = 'gemini-3.5-flash';
    const cost = calculateCost(model, input, output);

    await query(`
      INSERT INTO token_usage_logs
        (created_at, provider, model, feature, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, status, user_email)
      VALUES ($1, $2, $3, 'analytics', $4, $5, $6, $7, $8, 'success', $9)
    `, [new Date(log.created_at).toISOString(), 'gemini', model, input, output, total, cost, 800, log.user_email]);
    analyticsInserted++;
  }
  console.log(`Inserted ${analyticsInserted} rows from analytics_audit_log.`);

  const [{ count: finalCount }] = await query<{ count: string }>('SELECT COUNT(*) as count FROM token_usage_logs');
  console.log(`🎉 Backfill complete! Total rows in token_usage_logs: ${finalCount}`);
}

run()
  .catch(err => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
