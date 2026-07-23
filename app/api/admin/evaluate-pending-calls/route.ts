const ROUTE = 'admin/evaluate-pending-calls';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

export const maxDuration = 300; // 5 minutes max duration

function send(controller: ReadableStreamDefaultController, event: string, data: any, encoder: TextEncoder) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

async function _GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const { searchParams } = new URL(req.url);
  
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  // Fetch all call recordings that have a transcript, but no evaluation record yet
  const pendingCalls = await query<{ id: string }>(`
    SELECT cr.id
    FROM call_recordings cr
    LEFT JOIN call_evaluations ce ON ce.call_id = cr.id
    WHERE cr.transcript IS NOT NULL
      AND ce.call_id IS NULL
      AND cr.status NOT IN ('failed_transcription', 'failed_pipeline')
    ORDER BY cr.called_at DESC
  `);

  log.info(ROUTE, `Found ${pendingCalls.length} pending linked calls to evaluate.`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      send(controller, 'start', { total: pendingCalls.length }, encoder);

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < pendingCalls.length; i++) {
        const callId = pendingCalls[i].id;
        try {
          // Trigger the pipeline (runs evaluations and inserts into call_evaluations)
          const result = await runCallPipeline(callId);
          successCount++;
          send(controller, 'progress', {
            index: i + 1,
            total: pendingCalls.length,
            callId,
            success: true,
            iqs: result.iqs,
            verdict: result.verdict
          }, encoder);
        } catch (err: any) {
          failCount++;
          log.error(ROUTE, `Failed to evaluate pending call ${callId}: ${err.message}`);
          send(controller, 'progress', {
            index: i + 1,
            total: pendingCalls.length,
            callId,
            success: false,
            error: err.message
          }, encoder);
        }
      }

      send(controller, 'complete', { successCount, failCount }, encoder);
      controller.close();
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const GET = withLogging(ROUTE, _GET);
export const POST = withLogging(ROUTE, _GET);
