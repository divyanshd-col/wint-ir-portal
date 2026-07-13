import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

export async function GET(req: NextRequest) {
  let authorized = false;

  // 1. Check for secrets in query parameters
  const seedSecret = process.env.SEED_SECRET;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = req.headers.get('authorization') || '';
  const url = new URL(req.url);
  const urlSecret = url.searchParams.get('secret');

  const checkSecret = (sec: string | undefined) => {
    if (!sec) return false;
    return authHeader === `Bearer ${sec}` || urlSecret === sec;
  };

  if (checkSecret(seedSecret) || checkSecret(webhookSecret) || checkSecret(cronSecret)) {
    authorized = true;
  }

  // 2. Fallback to NextAuth session
  if (!authorized) {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;
    if (user && (user.isAdmin || user.role === 'tl' || user.role === 'admin' || user.role === 'quality')) {
      authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const callId = url.searchParams.get('callId');
  const forceRetranscribe = url.searchParams.get('forceRetranscribe') === 'true';

  if (!callId?.trim()) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  const cleanCallId = callId.trim();

  // Verify call exists in database before opening stream
  const rows = await query(`SELECT id FROM call_recordings WHERE id = $1`, [cleanCallId]);
  if (rows.length === 0) {
    return NextResponse.json({ error: `Call recording not found with ID: ${cleanCallId}` }, { status: 404 });
  }

  // Set up the SSE Stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Helper to push events to the client
      const pushEvent = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      pushEvent({ type: 'start', message: `Initializing stream for call ${cleanCallId}` });

      try {
        if (forceRetranscribe) {
          pushEvent({ type: 'progress', message: '[System] Clearing existing transcript for forced retranscription...' });
          await query(`
            UPDATE call_recordings
            SET transcript = NULL,
                status = 'stored',
                language = NULL,
                duration_seconds = NULL,
                interruption_count = 0,
                dead_air_count = 0,
                updated_at = NOW()
            WHERE id = $1
          `, [cleanCallId]);
        }

        // Run the pipeline and listen to progress
        const result = await runCallPipeline(cleanCallId, (msg) => {
          pushEvent({ type: 'progress', message: msg });
        });

        // Pipeline completed successfully
        pushEvent({ type: 'complete', result });
      } catch (err: any) {
        pushEvent({ type: 'error', message: err.message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
