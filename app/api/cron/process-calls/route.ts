const ROUTE = 'cron/process-calls';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

async function _GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  // 1. Fetch unprocessed calls (any call recording without evaluation or needing processing)
  const pendingCalls = await query<{ id: string; status: string }>(`
    SELECT cr.id, cr.status
    FROM call_recordings cr
    LEFT JOIN call_evaluations ce ON ce.call_id = cr.id
    WHERE (ce.call_id IS NULL OR cr.status IN ('received', 'stored'))
      AND cr.status NOT IN ('failed_transcription', 'failed_pipeline')
    ORDER BY cr.called_at DESC
    LIMIT 30
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
      
      // Update status to failed in DB to prevent infinite retry loops in same batch
      await query(
        `UPDATE call_recordings SET status = 'failed_pipeline', updated_at = NOW() WHERE id = $1`,
        [call.id]
      ).catch(() => {});
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
