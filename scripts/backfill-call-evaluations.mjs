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

// Import runCallPipeline dynamically from our Next.js codebase (compiled via node or using direct import if ESM is supported)
// Wait, since we are in a standalone Node script, running Next.js ts files directly can be tricky.
// So we will implement the db query and insertion loop directly in this script!
// For migrating existing scores, it is a pure sql translation.
// For evaluating unscored linked calls, we can trigger the HTTP endpoint /api/cron/process-calls or call a local lightweight evaluator!
// Let's implement the pure SQL backfill of already scored calls first.

function mapOldParamsToNew(oldParams) {
  if (!oldParams) return { scores: {}, evidence: {}, summary: '' };
  const mapping = {
    P1: 'TechnicalLegal',
    P2: 'AllQuestions',
    P3: 'Expectation',
    P5: 'CallOpening',
    P6: 'CallClosing',
    P7: 'Process',
    P8: 'Simplifying',
    P9: 'ActiveListening',
    P10: 'Fillers',
    P11: 'EnergyTone'
  };
  const scores = {};
  const evidence = {};
  Object.entries(mapping).forEach(([newKey, oldKey]) => {
    const entry = oldParams[oldKey] || oldParams[newKey] || {};
    // normalize score
    let score = 'NA';
    if (entry.score === true || entry.score === 'Yes') score = '2';
    else if (entry.score === false || entry.score === 'No') score = '0';
    else if (entry.score === '1' || entry.score === 1) score = '1';
    scores[newKey] = score;
    evidence[newKey] = [{ note: entry.reasoning || entry.evidence || '' }];
  });
  return { scores, evidence, summary: oldParams.summary || '' };
}

function finalVerdict(gateResult, iqsPercent) {
  if (gateResult === 'FAIL') return 'FAILED_CRITICAL';
  if (iqsPercent === null || iqsPercent === undefined) return 'NOT_SCOREABLE';
  if (iqsPercent >= 90) return 'excellent';
  if (iqsPercent >= 75) return 'meets_expectations';
  if (iqsPercent >= 60) return 'coaching';
  return 'remediation';
}

try {
  console.log('🔄 Querying existing calls scored in iqs_scores table…');
  const scoredCallsRes = await pool.query(`
    SELECT
      r.id                                    AS "callId",
      r.chat_id                               AS "chatId",
      r.agent_id                              AS "agentId",
      r.called_at                             AS "calledAt",
      r.duration_seconds                      AS "durationSeconds",
      r.language                              AS "language",
      s.call_iqs_score                        AS "iqs",
      s.call_parameters                       AS "parameters",
      s.call_model_version                    AS "modelVersion",
      s.call_scored_at                        AS "scoredAt",
      s.reviewed_by                           AS "reviewedBy",
      s.reviewed_at                           AS "reviewedAt",
      s.review_note                           AS "reviewNote"
    FROM call_recordings r
    JOIN iqs_scores s ON s.chat_id = r.chat_id
    WHERE s.call_iqs_score IS NOT NULL
  `);

  console.log(`Found ${scoredCallsRes.rows.length} scored calls to migrate.`);

  let migratedCount = 0;
  for (const row of scoredCallsRes.rows) {
    const { scores, evidence, summary } = mapOldParamsToNew(row.parameters);
    const iqsScoresPayload = { scores, evidence, summary };
    const verdict = finalVerdict('PASS', row.iqs);

    const status = row.reviewedBy ? 'reviewed' : 'pending';

    // Insert into call_evaluations
    await pool.query(`
      INSERT INTO call_evaluations (
        call_id, chat_id, agent_id, call_sequence_in_thread, scored_at,
        gates_prompt_version, iqs_prompt_version, source, speaker_id_confidence, context_truncated,
        call_gate_result, gates, iqs_scores, iqs_percent, applicable_weight, verdict,
        reviewed_by, reviewed_at, review_note, status
      ) VALUES ($1, $2, $3, 1, $4, 'legacy-v3.0', $5, 'audio', 'low', false, 'PASS', '{}', $6, $7, 100, $8, $9, $10, $11, $12)
      ON CONFLICT (call_id) DO UPDATE SET
        iqs_scores = EXCLUDED.iqs_scores,
        iqs_percent = EXCLUDED.iqs_percent,
        verdict = EXCLUDED.verdict,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = EXCLUDED.reviewed_at,
        review_note = EXCLUDED.review_note,
        status = EXCLUDED.status
    `, [
      row.callId,
      row.chatId,
      row.agentId,
      row.scoredAt || new Date(),
      row.modelVersion || 'v3.0',
      JSON.stringify(iqsScoresPayload),
      row.iqs,
      verdict,
      row.reviewedBy || null,
      row.reviewedAt || null,
      row.reviewNote || null,
      status
    ]);

    migratedCount++;
  }
  console.log(`✅ Migrated ${migratedCount} call evaluations successfully.`);

  // Update status in call_recordings to scored for migrated ones
  await pool.query(`
    UPDATE call_recordings
    SET status = 'scored'
    WHERE id IN (SELECT call_id FROM call_evaluations)
  `);
  console.log('✅ Updated status in call_recordings for scored evaluations.');

  // Check how many calls are still unscored ('linked' or 'transcribed')
  const pendingCallsRes = await pool.query(`
    SELECT COUNT(*) as count 
    FROM call_recordings r
    LEFT JOIN call_evaluations e ON e.call_id = r.id
    WHERE r.status IN ('linked', 'transcribed') AND e.call_id IS NULL
  `);
  console.log(`ℹ️ There are ${pendingCallsRes.rows[0].count} linked/transcribed calls still pending evaluation.`);
  console.log('Run the `/api/cron/process-calls` cron endpoint to evaluate and import them.');

} catch (err) {
  console.error('❌ Error during backfill:', err.message);
} finally {
  await pool.end();
}
