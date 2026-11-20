/**
 * app/api/cron/email-batch-eval/route.ts
 *
 * Automated cron & on-demand endpoint for email quality evaluation.
 * 1. Collects and processes results from any active Gemini Batch jobs.
 * 2. Evaluates newly pending email replies:
 *    - For small queues (<= 20): evaluates directly via synchronous model calls.
 *    - For larger queues (> 20): submits them to Gemini Batch API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import {
  submitPendingEmailBatchJob,
  collectAndProcessEmailBatchResults,
  evaluateSingleReplySync,
} from '@/lib/email/gemini-batch-evaluator';
import { evaluatePcgEmailReplySync } from '@/lib/scoring/pcg-email-pipeline';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${cronSecret}`) return true;
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') === cronSecret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  return handleBatchCron(req);
}

export async function POST(req: NextRequest) {
  return handleBatchCron(req);
}

async function handleBatchCron(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'run_full'; // 'run_full', 'collect', 'submit', 'sync_only'
  const windowParam = searchParams.get('window'); // '3pm' | 'overnight'

  try {
    let collectionResult = null;
    let submissionResult = null;
    const directEvalResults: { messageId: string; success: boolean; score?: number; error?: string }[] = [];

    // 1. Collect existing active batch jobs
    if (action === 'run_full' || action === 'collect') {
      collectionResult = await collectAndProcessEmailBatchResults();
    }

    // 2. Process or submit new pending replies
    if (action === 'run_full' || action === 'submit' || action === 'sync_only') {
      let cutoffTime: string | undefined;

      if (windowParam === '3pm') {
        const today3pm = new Date();
        today3pm.setHours(15, 0, 0, 0);
        cutoffTime = today3pm.toISOString();
      }

      // Check how many pending items exist
      let pendingSql = `SELECT message_id FROM email_reply_evaluations WHERE evaluation_status = 'Pending'`;
      const params: any[] = [];
      if (cutoffTime) {
        params.push(cutoffTime);
        pendingSql += ` AND sent_at <= $1`;
      }
      pendingSql += ` ORDER BY sent_at ASC LIMIT 100`;

      const pendingRows = await query(pendingSql, params);
      const pendingCount = pendingRows ? pendingRows.length : 0;

      // Small batch (<= 20) or forced sync_only -> process directly in sync mode
      if (action === 'sync_only' || (pendingCount > 0 && pendingCount <= 20)) {
        for (const row of pendingRows) {
          try {
            const res = await evaluateSingleReplySync(row.message_id);
            directEvalResults.push({
              messageId: row.message_id,
              success: true,
              score: res.quality_score,
            });
          } catch (err: any) {
            console.error(`[cron/email-batch-eval] Failed evaluating ${row.message_id}:`, err);
            directEvalResults.push({
              messageId: row.message_id,
              success: false,
              error: err?.message || String(err),
            });
          }
        }
      } else if (pendingCount > 20) {
        // Larger queue -> Submit to Gemini Batch API
        submissionResult = await submitPendingEmailBatchJob({ cutoffTime });
      }
    }

    // 3. Process pending PCG email replies using PCG evaluation pipeline & shared PCG KBs
    const pcgEvalResults: { messageId: string; success: boolean; score?: number; error?: string }[] = [];
    try {
      const pendingPcgRows = await query<any>(
        `SELECT message_id FROM pcg_email_evaluations
         WHERE evaluation_status = 'Pending'
         ORDER BY sent_at ASC
         LIMIT 50`
      );
      for (const pRow of pendingPcgRows) {
        try {
          const pRes = await evaluatePcgEmailReplySync(pRow.message_id);
          pcgEvalResults.push({
            messageId: pRow.message_id,
            success: true,
            score: pRes.iqsScore,
          });
        } catch (pErr: any) {
          console.error(`[cron/email-batch-eval] Failed evaluating PCG email reply ${pRow.message_id}:`, pErr);
          pcgEvalResults.push({
            messageId: pRow.message_id,
            success: false,
            error: pErr?.message || String(pErr),
          });
        }
      }
    } catch (pcgScanErr: any) {
      console.warn('[cron/email-batch-eval] Could not query pcg_email_evaluations:', pcgScanErr?.message || pcgScanErr);
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      action,
      collection: collectionResult,
      directEvaluations: directEvalResults.length > 0 ? directEvalResults : undefined,
      pcgEvaluations: pcgEvalResults.length > 0 ? pcgEvalResults : undefined,
      submission: submissionResult,
    });
  } catch (err: any) {
    console.error('[cron/email-batch-eval] Error running evaluation cron:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
