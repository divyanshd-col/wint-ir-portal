const ROUTE = 'admin/re-evaluate-calls';
import { log, withLogging } from '@/lib/log';
import { NextRequest } from 'next/server';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

export const maxDuration = 300; // 5 minutes max duration

function send(controller: ReadableStreamDefaultController, event: string, data: any, encoder: TextEncoder) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

async function _GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const { searchParams } = new URL(req.url);
  
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Fetch all call evaluations that we want to re-analyze
  const evaluations = await query<{ call_id: string }>(`
    SELECT call_id FROM call_evaluations
    ORDER BY scored_at DESC
  `);

  log.info(ROUTE, `Found ${evaluations.length} call evaluations to re-analyze.`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      send(controller, 'start', { total: evaluations.length }, encoder);

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < evaluations.length; i++) {
        const callId = evaluations[i].call_id;
        try {
          // Trigger the pipeline (runs with the latest Gemini 3.1 Flash Lite model configuration)
          const result = await runCallPipeline(callId);
          successCount++;
          send(controller, 'progress', {
            index: i + 1,
            total: evaluations.length,
            callId,
            success: true,
            iqs: result.iqs,
            verdict: result.verdict
          }, encoder);
        } catch (err: any) {
          failCount++;
          log.error(ROUTE, `Failed to re-evaluate call ${callId}: ${err.message}`);
          send(controller, 'progress', {
            index: i + 1,
            total: evaluations.length,
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

  return new Response(stream, {
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
