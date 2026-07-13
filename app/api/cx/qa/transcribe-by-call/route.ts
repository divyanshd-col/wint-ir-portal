import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { log, withLogging } from '@/lib/log';
import { segmentsToText } from '@/lib/call-quality';

const ROUTE = 'cx/qa/transcribe-by-call';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handleTranscribe(req: NextRequest): Promise<NextResponse> {
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

  // 2. Fallback to NextAuth session
  if (!authorized) {
    const session = await getServerSession(authOptions);
    const user    = session?.user as any;
    if (user && (user.isAdmin || user.role === 'tl' || user.role === 'admin' || user.role === 'quality')) {
      authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Parse input
  let callId: string | null = url.searchParams.get('callId');

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body?.callId) {
        callId = body.callId;
      }
    } catch {}
  }

  if (!callId?.trim()) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  const cleanCallId = callId.trim();

  // Verify call exists in database
  const rows = await query(`SELECT id, recording_url FROM call_recordings WHERE id = $1`, [cleanCallId]);
  if (rows.length === 0) {
    return NextResponse.json({ error: `Call recording not found with ID: ${cleanCallId}` }, { status: 404 });
  }

  const call = rows[0];
  if (!call.recording_url) {
    return NextResponse.json({ error: `Call recording ${cleanCallId} has no recording_url to transcribe` }, { status: 400 });
  }

  log.info(ROUTE, `Starting manual transcription and evaluation for call ID: ${cleanCallId}`);

  try {
    // Reset transcription status in the database to force runCallPipeline to transcribe
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

    const result = await runCallPipeline(cleanCallId);

    // Fetch and log the call transcript
    let chatId = null;
    let newTranscript = null;
    try {
      const callRows = await query(`SELECT transcript, chat_id FROM call_recordings WHERE id = $1`, [cleanCallId]);
      if (callRows.length > 0) {
        chatId = callRows[0].chat_id;
        if (callRows[0].transcript) {
          const segments = Array.isArray(callRows[0].transcript)
            ? callRows[0].transcript
            : (callRows[0].transcript as any).segments || [];
          newTranscript = segments;
          const formattedText = segmentsToText(segments);
          log.info(ROUTE, `Call transcript for ID ${cleanCallId} (Chat: ${chatId}):\n${formattedText}`);
        }
      }
    } catch (logErr: any) {
      log.warn(ROUTE, `Failed to retrieve or format transcript for logging: ${logErr.message}`);
    }

    log.info(ROUTE, `Transcription rerun successful for call ID: ${cleanCallId}`, { result: { ...result, chatId } });
    return NextResponse.json({ ok: true, result: { ...result, chatId, transcript: newTranscript } });
  } catch (err: any) {
    log.error(ROUTE, `Transcription rerun failed for call ID: ${cleanCallId}: ${err.message}`);
    return NextResponse.json({ error: `Pipeline/Transcription failed: ${err.message}` }, { status: 502 });
  }
}

export const GET = withLogging(ROUTE, handleTranscribe);
export const POST = withLogging(ROUTE, handleTranscribe);
