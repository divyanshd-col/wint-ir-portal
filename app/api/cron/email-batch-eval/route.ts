/**
 * app/api/cron/email-batch-eval/route.ts
 *
 * Automated cron & webhook endpoint for batch evaluation.
 * Runs at 3:00 PM and Midnight/Overnight.
 * 1. Collects results from any active batch jobs.
 * 2. Submits newly pending email replies to Gemini Batch API.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  submitPendingEmailBatchJob,
  collectAndProcessEmailBatchResults,
} from '@/lib/email/gemini-batch-evaluator';

export async function GET(req: NextRequest) {
  return handleBatchCron(req);
}

export async function POST(req: NextRequest) {
  return handleBatchCron(req);
}

async function handleBatchCron(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'run_full'; // 'run_full', 'collect', 'submit'
  const windowParam = searchParams.get('window'); // '3pm' | 'overnight'

  try {
    let collectionResult = null;
    let submissionResult = null;

    // 1. Collect existing active batch jobs
    if (action === 'run_full' || action === 'collect') {
      collectionResult = await collectAndProcessEmailBatchResults();
    }

    // 2. Submit new pending replies
    if (action === 'run_full' || action === 'submit') {
      let cutoffTime: string | undefined;

      if (windowParam === '3pm') {
        // e.g. emails up until 3:00 PM today
        const today3pm = new Date();
        today3pm.setHours(15, 0, 0, 0);
        cutoffTime = today3pm.toISOString();
      }

      submissionResult = await submitPendingEmailBatchJob({ cutoffTime });
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      action,
      collection: collectionResult,
      submission: submissionResult,
    });
  } catch (err: any) {
    console.error('[cron/email-batch-eval] Error running batch evaluation:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
