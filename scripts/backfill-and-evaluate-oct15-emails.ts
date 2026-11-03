/**
 * scripts/backfill-and-evaluate-oct15-emails.ts
 *
 * Ingests all human email replies received from October 15, 2026 onwards into email_reply_evaluations
 * and submits them to the Gemini Batch API for automated quality evaluation.
 */

import './_load-env';
import { query } from '@/lib/cx/db';
import { ingestEmailReply } from '@/lib/email/ingest';
import {
  submitPendingEmailBatchJob,
  collectAndProcessEmailBatchResults,
} from '@/lib/email/gemini-batch-evaluator';

const OCT_15_CUTOFF = '2026-10-15T15:48:00.000Z';

async function main() {
  console.log('========================================================================');
  console.log('       EMAIL INGESTION & BATCH EVALUATION (OCT 15 ONWARDS)              ');
  console.log('========================================================================\n');

  // Step 1: Collect any pending active batch jobs first
  console.log('1. Checking and collecting any completed Gemini Batch jobs...');
  try {
    const collectRes = await collectAndProcessEmailBatchResults();
    console.log('   Active jobs:', collectRes.activeJobsCount, '| Completed jobs collected:', collectRes.completedJobsCount, '| Replies updated:', collectRes.evaluatedRepliesCount);
  } catch (err: any) {
    console.warn('   Could not collect existing batches (safe to proceed):', err.message);
  }

  // Step 2: Fetch all REPLY_SENT events since Oct 15
  console.log('\n2. Fetching REPLY_SENT events from robylon_webhook_payloads >= ' + OCT_15_CUTOFF + '...');
  const events = await query(`
    SELECT id, chat_id, event_type, received_at, payload
    FROM robylon_webhook_payloads
    WHERE source = 'email'
      AND event_type = 'REPLY_SENT'
      AND received_at >= $1
    ORDER BY received_at ASC
  `, [OCT_15_CUTOFF]);

  console.log(`   Found ${events.length} total REPLY_SENT events.`);

  // Step 3: Ingest them into email_conversations and email_reply_evaluations
  console.log('\n3. Ingesting replies into email_reply_evaluations (status: Pending)...');
  let ingestedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    try {
      const res = await ingestEmailReply(ev.payload);
      if (res.inserted) {
        ingestedCount++;
      } else {
        skippedCount++;
      }
    } catch (err: any) {
      console.error(`   Error ingesting payload ${ev.id}:`, err.message);
    }

    if ((i + 1) % 250 === 0 || i === events.length - 1) {
      console.log(`   Processed ${i + 1} / ${events.length} events... (Ingested: ${ingestedCount}, Skipped: ${skippedCount})`);
    }
  }

  console.log(`\n   ✓ Total ingested: ${ingestedCount} | Skipped (AI/empty): ${skippedCount}`);

  // Step 4: Count pending evaluations
  const pendingCheck = await query(`
    SELECT COUNT(*) as count
    FROM email_reply_evaluations
    WHERE evaluation_status = 'Pending'
  `);
  const pendingTotal = Number(pendingCheck[0]?.count || 0);
  console.log(`\n4. Total pending replies waiting for evaluation in DB: ${pendingTotal}`);

  if (pendingTotal === 0) {
    console.log('   No pending replies to submit.');
    return;
  }

  // Step 5: Submit pending replies to Gemini Batch API in chunks of up to 1,000
  console.log('\n5. Submitting pending evaluations to Gemini Batch API in chunks of 1,000...');
  const GEMINI_CHUNK_SIZE = 1000;
  let remaining = pendingTotal;
  let batchNum = 1;

  while (remaining > 0) {
    const chunkLimit = Math.min(remaining, GEMINI_CHUNK_SIZE);
    console.log(`   Submitting batch #${batchNum} (limit: ${chunkLimit})...`);

    const res = await submitPendingEmailBatchJob({ limit: chunkLimit });
    if (!res.success || res.count === 0) {
      console.log(`   Batch submission returned count 0 or message: ${res.message}`);
      break;
    }

    console.log(`   ✓ Batch #${batchNum} created: ${res.batchJobName} (${res.count} items)`);
    remaining -= res.count;
    batchNum++;
  }

  console.log('\n========================================================================');
  console.log('                          EXECUTION COMPLETE                            ');
  console.log('========================================================================\n');
}

main().catch(err => {
  console.error('Fatal script error:', err);
  process.exit(1);
});

