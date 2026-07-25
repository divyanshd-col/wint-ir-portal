import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let authorized = false;

  // 1. Check for secrets in headers or query parameters
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

  // 2. Fallback to NextAuth session. TL is view-only for chat quality — admin only.
  if (!authorized) {
    const session = await getServerSession(authOptions);
    const user    = session?.user as any;
    if (user && user.isAdmin) {
      authorized = true;
    }
  }

  if (!authorized) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const callId = body.callId || url.searchParams.get('callId');
  if (!callId) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  log.info('cx/qa/rerun-by-call', `Manually triggering rerun for call ${callId}`);

  try {
    const result = await runCallPipeline(callId, { forceTranscript: true });
    const { query } = await import('@/lib/cx/db');
    const recRes = await query<any>('SELECT transcript FROM call_recordings WHERE id = $1', [callId]);
    const evalRes = await query<any>('SELECT * FROM call_evaluations WHERE call_id = $1', [callId]);

    return NextResponse.json({
      ok: true,
      message: `Call evaluation completed for call ${callId}`,
      result,
      transcript: recRes[0]?.transcript || null,
      evaluation: evalRes[0] || null,
    });
  } catch (err: any) {
    log.error('cx/qa/rerun-by-call', `Failed manual evaluation for call ${callId}: ${err.message}`);
    return NextResponse.json({
      ok: false,
      error: err.message,
    }, { status: 500 });
  }
}
