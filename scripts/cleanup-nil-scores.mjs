/**
 * Cleanup script: Updates historical 0 scores for unconnected/junk calls and empty chats to NIL (NULL).
 *
 * Run with: node scripts/cleanup-nil-scores.mjs [--apply]
 */

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

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(`\n=== CLEANUP 0 SCORES -> NIL (${isApply ? 'APPLYING CHANGES' : 'DRY RUN - PREVIEW ONLY'}) ===\n`);

  // 1. Find call_evaluations with 0 IQS that are Junk Chats / Voicemail / Unconnected
  const callRows = await pool.query(`
    SELECT ce.call_id, ce.chat_id, ce.iqs_percent, cr.call_disposition, cr.call_sub_disposition, ce.iqs_scores->>'summary' as summary, ce.iqs_scores
    FROM call_evaluations ce
    JOIN call_recordings cr ON cr.id = ce.call_id
    WHERE (ce.iqs_percent = 0 OR ce.iqs_percent = '0.00' OR ce.iqs_percent = '0')
      AND (
        cr.call_disposition ILIKE '%junk%'
        OR cr.call_sub_disposition ILIKE '%no query%'
        OR ce.iqs_scores->>'summary' ILIKE '%voicemail%'
        OR ce.iqs_scores->>'summary' ILIKE '%no conversation%'
        OR ce.iqs_scores->>'summary' ILIKE '%did not connect%'
        OR ce.iqs_scores->>'summary' ILIKE '%hung up%'
        OR ce.iqs_scores->>'summary' ILIKE '%unanswered%'
      )
  `);

  console.log(`Found ${callRows.rows.length} call_evaluations with 0 IQS from unconnected/junk calls:`);
  for (const r of callRows.rows) {
    console.log(`  - Call ${r.call_id} (Chat ${r.chat_id}) | Dispo: ${r.call_disposition} > ${r.call_sub_disposition} | Summary: ${r.summary?.slice(0, 75)}...`);
  }

  if (isApply && callRows.rows.length > 0) {
    for (const r of callRows.rows) {
      const scores = r.iqs_scores?.scores || {};
      const updatedScores = { ...scores };
      for (const k of Object.keys(updatedScores)) {
        updatedScores[k] = 'NA';
      }
      const updatedIqsScores = {
        ...r.iqs_scores,
        scores: updatedScores,
      };

      await pool.query(`
        UPDATE call_evaluations
        SET iqs_percent = NULL,
            applicable_weight = 0,
            iqs_scores = $1
        WHERE call_id = $2
      `, [JSON.stringify(updatedIqsScores), r.call_id]);
    }
    console.log(`\n✅ Successfully updated ${callRows.rows.length} call_evaluations to NIL (NULL)!`);
  }

  // 2. Also check iqs_scores table where call_iqs_score = 0
  const iqsCallScores = await pool.query(`
    SELECT chat_id, call_iqs_score, call_parameters
    FROM iqs_scores
    WHERE call_iqs_score = 0
  `);
  console.log(`\nFound ${iqsCallScores.rows.length} iqs_scores rows with call_iqs_score = 0:`);
  for (const r of iqsCallScores.rows) {
    console.log(`  - Chat ${r.chat_id} | call_iqs_score: ${r.call_iqs_score}`);
  }

  if (isApply && iqsCallScores.rows.length > 0) {
    await pool.query(`
      UPDATE iqs_scores
      SET call_iqs_score = NULL
      WHERE call_iqs_score = 0
    `);
    console.log(`\n✅ Successfully updated ${iqsCallScores.rows.length} rows in iqs_scores (call_iqs_score = NULL)!`);
  }

  // 3. Find bot chats with 0 IQS where all parameters are NA (inactive / no query asked)
  const botChatRows = await pool.query(`
    SELECT chat_id, iqs_score, parameters
    FROM iqs_scores
    WHERE iqs_score = 0
      AND parameters::text ILIKE '%__bot_parameters%'
      AND (
        parameters::text ILIKE '%no substantive%'
        OR parameters::text ILIKE '%did not state any query%'
        OR parameters::text ILIKE '%no query%'
        OR parameters::text ILIKE '%closed due to inactivity%'
      )
  `);

  console.log(`\nFound ${botChatRows.rows.length} inactive bot chats with 0 IQS where no query occurred:`);
  for (const r of botChatRows.rows.slice(0, 10)) {
    console.log(`  - Chat ${r.chat_id} | iqs_score: ${r.iqs_score}`);
  }
  if (botChatRows.rows.length > 10) {
    console.log(`  ... and ${botChatRows.rows.length - 10} more`);
  }

  if (isApply && botChatRows.rows.length > 0) {
    for (const r of botChatRows.rows) {
      const params = r.parameters || {};
      const scores = params.__scores || {};
      const updatedParams = {
        ...params,
        __scores: {
          ...scores,
          bot_iqs: null,
        },
      };

      await pool.query(`
        UPDATE iqs_scores
        SET iqs_score = NULL,
            parameters = $1
        WHERE chat_id = $2
      `, [JSON.stringify(updatedParams), r.chat_id]);
    }
    console.log(`\n✅ Successfully updated ${botChatRows.rows.length} bot chats to NIL (NULL)!`);
  }

  // 4. Find all junk chats and junk calls that have ANY non-null IQS score
  const junkChats = await pool.query(`
    SELECT s.chat_id, s.iqs_score, s.bot_iqs_score, s.call_iqs_score, c.tags
    FROM iqs_scores s
    JOIN conversations c ON c.id = s.chat_id
    WHERE c.tags::text ILIKE '%junk%'
      AND (s.iqs_score IS NOT NULL OR s.bot_iqs_score IS NOT NULL OR s.call_iqs_score IS NOT NULL)
  `);
  console.log(`\nFound ${junkChats.rows.length} junk chats with non-null IQS score:`);
  for (const r of junkChats.rows.slice(0, 10)) {
    console.log(`  - Chat ${r.chat_id} | iqs: ${r.iqs_score} | bot: ${r.bot_iqs_score} | call: ${r.call_iqs_score}`);
  }
  if (junkChats.rows.length > 10) {
    console.log(`  ... and ${junkChats.rows.length - 10} more`);
  }

  const junkCalls = await pool.query(`
    SELECT ce.call_id, ce.chat_id, ce.iqs_percent, ce.verdict, cr.call_disposition, cr.call_sub_disposition, c.tags as chat_tags
    FROM call_evaluations ce
    JOIN call_recordings cr ON cr.id = ce.call_id
    LEFT JOIN conversations c ON c.id = cr.chat_id
    WHERE (
      cr.call_disposition ILIKE '%junk%'
      OR cr.call_sub_disposition ILIKE '%junk%'
      OR c.tags::text ILIKE '%junk%'
    )
    AND (ce.iqs_percent IS NOT NULL OR ce.verdict IS DISTINCT FROM 'NOT_SCOREABLE')
  `);
  console.log(`\nFound ${junkCalls.rows.length} junk calls with non-null IQS or scoreable verdict:`);
  for (const r of junkCalls.rows.slice(0, 10)) {
    console.log(`  - Call ${r.call_id} | iqs_percent: ${r.iqs_percent} | verdict: ${r.verdict}`);
  }
  if (junkCalls.rows.length > 10) {
    console.log(`  ... and ${junkCalls.rows.length - 10} more`);
  }

  if (isApply) {
    if (junkChats.rows.length > 0) {
      await pool.query(`
        UPDATE iqs_scores s
        SET iqs_score = NULL,
            bot_iqs_score = NULL,
            call_iqs_score = NULL
        FROM conversations c
        WHERE s.chat_id = c.id
          AND c.tags::text ILIKE '%junk%'
          AND (s.iqs_score IS NOT NULL OR s.bot_iqs_score IS NOT NULL OR s.call_iqs_score IS NOT NULL)
      `);
      console.log(`\n✅ Successfully marked ${junkChats.rows.length} junk chats as NIL (NULL)!`);
    }

    if (junkCalls.rows.length > 0) {
      await pool.query(`
        UPDATE call_evaluations ce
        SET iqs_percent = NULL,
            applicable_weight = 0,
            verdict = 'NOT_SCOREABLE'
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        WHERE ce.call_id = cr.id
          AND (
            cr.call_disposition ILIKE '%junk%'
            OR cr.call_sub_disposition ILIKE '%junk%'
            OR c.tags::text ILIKE '%junk%'
          )
          AND (ce.iqs_percent IS NOT NULL OR ce.verdict IS DISTINCT FROM 'NOT_SCOREABLE')
      `);

      await pool.query(`
        UPDATE iqs_scores s
        SET call_iqs_score = NULL
        FROM call_recordings cr
        WHERE s.chat_id = cr.chat_id
          AND (
            cr.call_disposition ILIKE '%junk%'
            OR cr.call_sub_disposition ILIKE '%junk%'
          )
          AND s.call_iqs_score IS NOT NULL
      `);
      console.log(`\n✅ Successfully marked ${junkCalls.rows.length} junk calls as NIL (NULL)!`);
    }
  }

  console.log('\n=== DONE ===\n');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error during cleanup:', err);
  process.exit(1);
});
