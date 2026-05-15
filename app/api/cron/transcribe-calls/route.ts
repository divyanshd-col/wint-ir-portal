/**
 * GET /api/cron/transcribe-calls
 *
 * Runs every 10 minutes (vercel.json). Picks up call_recordings rows with
 * status='pending_transcription', fetches the audio from S3, transcribes with
 * Gemini, and advances status to 'pending_link'.
 *
 * This replaces the old fire-and-forget pattern in the CC_VOICE_CALL_COMPLETE
 * webhook handler, which was killed by Vercel before it could complete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys } from '@/lib/gemini';
import { geminiGenerate } from '@/lib/gemini';
import {
  getCallsForTranscription,
  insertCallRecording,
  updateCallRecordingMetrics,
  updateCallRecordingStatus,
} from '@/lib/robylon/db';
import {
  CALL_TRANSCRIPTION_PROMPT,
  parseTranscriptionResponse,
} from '@/lib/call-quality';

export const runtime = 'nodejs';
export const maxDuration = 300;

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    return NextResponse.json({ ok: false, reason: 'No Gemini API key configured' });
  }

  const pending = await getCallsForTranscription(5);
  if (!pending.length) {
    return NextResponse.json({ ok: true, transcribed: 0, message: 'No pending calls' });
  }

  let transcribed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const call of pending) {
    if (!call.recording_url) {
      await updateCallRecordingStatus(call.id, 'error_no_url');
      failed++;
      continue;
    }

    try {
      let mimeType = mimeFromUrl(call.recording_url);
      const audioRes = await fetch(call.recording_url, { signal: AbortSignal.timeout(60_000) });
      if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status} fetching audio`);
      const ct = audioRes.headers.get('content-type')?.split(';')[0].trim() || '';
      if (ct && ct.startsWith('audio/') && ct !== 'audio/octet-stream') mimeType = ct;
      const audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');

      const raw = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: CALL_TRANSCRIPTION_PROMPT },
        ]}],
        {},
        120_000,
      );

      const { language, segments } = parseTranscriptionResponse(raw);
      const interruptionCount = segments.filter(s => s.type === 'interruption').length;
      const deadAirCount      = segments.filter(s => s.type === 'dead_air').length;

      await insertCallRecording({
        id:              call.id,
        chatId:          call.chat_id,
        agentId:         call.agent_id,
        contactId:       call.contact_id,
        recordingUrl:    call.recording_url,
        durationSeconds: call.duration_seconds,
        calledAt:        call.called_at,
        language,
        transcript:      segments,
        status:          'transcribed',
      });
      await updateCallRecordingMetrics({ id: call.id, interruptionCount, deadAirCount, status: 'pending_link' });

      console.log(`[cron/transcribe-calls] Transcribed call ${call.id} — ${segments.length} segments (${language})`);
      transcribed++;
    } catch (err: any) {
      console.error(`[cron/transcribe-calls] Failed to transcribe call ${call.id}:`, err.message);
      errors.push(`${call.id}: ${err.message}`);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, transcribed, failed, errors });
}
