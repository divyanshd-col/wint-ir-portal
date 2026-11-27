const ROUTE = 'cron/process-calls';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { ensureRetryColumns, recordCallPipelineFailure } from '@/lib/robylon/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

export const maxDuration = 300;

async function _GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  await ensureRetryColumns();

  // 1. Fetch unprocessed calls from the last 7 days with < 3 failed retries
  const pendingCalls = await query(`
    SELECT cr.id, cr.status
    FROM call_recordings cr
    LEFT JOIN call_evaluations ce ON ce.call_id = cr.id
    WHERE cr.status IN ('received', 'stored', 'linked', 'transcribed')
      AND (ce.call_id IS NULL OR cr.status IN ('received', 'stored'))
      AND cr.called_at >= NOW() - INTERVAL '7 days'
      AND COALESCE(cr.retry_count, 0) < 3
    ORDER BY cr.called_at DESC
    LIMIT 10
  `);

  log.info(ROUTE, `[cron] Found ${pendingCalls.length} calls pending evaluation processing`);

  const results: any[] = [];
  for (const call of pendingCalls) {
    try {
      const res = await runCallPipeline(call.id);
      results.push({ callId: call.id, success: true, verdict: res.verdict, iqs: res.iqs });
    } catch (err: any) {
      log.error(ROUTE, `[cron] Error processing call ${call.id}: ${err.message}`);
      results.push({ callId: call.id, success: false, error: err.message });
      await recordCallPipelineFailure(call.id, err.message).catch(() => {});
    }
  }

  const successCount = results.filter(r => r.success).length;
  log.info(ROUTE, `[cron] process-calls: successfully processed ${successCount}/${pendingCalls.length} calls`);

  return NextResponse.json({
    ok: true,
    processedCount: pendingCalls.length,
    successCount,
    results
  });
}

export const GET = withLogging(ROUTE, _GET);
export const POST = withLogging(ROUTE, _GET);
