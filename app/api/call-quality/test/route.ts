/**
 * POST /api/call-quality/test
 *
 * Test endpoint — looks up a call recording by call_id and runs the full
 * transcription + scoring pipeline. Nothing is written to the database.
 *
 * Body: { call_id: string, chat_id?: string }
 * Auth: same session-based auth as all other routes (admin / quality / tl)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_IQS_SYSTEM_PROMPT,
  buildCallScoringPrompt,
  parseTranscriptionResponse,
  parseCallScoringResponse,
  segmentsToText,
} from '@/lib/call-quality';
import { getCallRecording, getConversation } from '@/lib/robylon/db';

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function transcriptToText(transcript: any): string {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript;
  if (!Array.isArray(transcript)) return '';
  return transcript
    .map((m: any) => {
      const sender = m.sender_type === 'agent' ? 'Agent' : 'Customer';
      return `${sender}: ${m.message || m.content || m.text || ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && !['quality', 'tl', 'admin'].includes(user?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { call_id?: string; chat_id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { call_id, chat_id } = body;
  if (!call_id?.trim()) {
    return NextResponse.json({ error: 'call_id is required' }, { status: 400 });
  }

  const config    = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured on this portal' }, { status: 503 });
  }

  // ── Lookup call recording from DB ────────────────────────────────────────
  const callRow = await getCallRecording(call_id.trim());
  if (!callRow) {
    return NextResponse.json({ error: `No call_recording found for call_id: ${call_id}` }, { status: 404 });
  }

  // ── Lookup chat transcript from DB (optional) ────────────────────────────
  let chat_transcript = '';
  if (chat_id?.trim()) {
    const conv = await getConversation(chat_id.trim());
    if (conv?.transcript) {
      chat_transcript = transcriptToText(conv.transcript);
    }
  }

  // ── Step 1: Get transcript — use stored if available, else transcribe ─────
  let segments: any[];
  let language: string;
  let interruptionCount: number;
  let deadAirCount: number;
  let transcriptionMs = 0;

  const storedSegments = Array.isArray(callRow.transcript) && callRow.transcript.length > 0
    ? callRow.transcript : null;

  if (storedSegments) {
    segments         = storedSegments;
    language         = callRow.language || 'Unknown';
    interruptionCount = callRow.interruption_count ?? segments.filter((s: any) => s.type === 'interruption').length;
    deadAirCount      = callRow.dead_air_count     ?? segments.filter((s: any) => s.type === 'dead_air').length;
  } else {
    const recording_url = callRow.recording_url;
    if (!recording_url) {
      return NextResponse.json({ error: 'Call recording has no transcript and no recording_url to fetch' }, { status: 422 });
    }

    let audioBase64 = '';
    let mimeType    = mimeFromUrl(recording_url);
    try {
      const res = await fetch(recording_url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching recording`);
      const ct = res.headers.get('content-type')?.split(';')[0].trim() || '';
      if (ct && ct.startsWith('audio/') && ct !== 'audio/octet-stream') mimeType = ct;
      audioBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    } catch (err: any) {
      return NextResponse.json({ error: `Could not fetch recording: ${err.message}` }, { status: 422 });
    }

    const t1 = Date.now();
    let transcriptionRaw: string;
    try {
      transcriptionRaw = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: CALL_TRANSCRIPTION_PROMPT },
        ]}],
        {},
        120_000,
      );
    } catch (err: any) {
      return NextResponse.json({ error: `Transcription failed: ${err.message}` }, { status: 502 });
    }
    transcriptionMs = Date.now() - t1;

    ({ language, segments } = parseTranscriptionResponse(transcriptionRaw));
    interruptionCount = segments.filter((s: any) => s.type === 'interruption').length;
    deadAirCount      = segments.filter((s: any) => s.type === 'dead_air').length;
  }

  // ── Step 3: Score ────────────────────────────────────────────────────────
  const t2 = Date.now();
  const callTranscriptText = segmentsToText(segments);
  const scoringPrompt = buildCallScoringPrompt(
    callTranscriptText,
    chat_transcript,
    'test',
    interruptionCount,
    deadAirCount,
  );

  let scoringRaw: string;
  try {
    scoringRaw = await geminiGenerate(
      geminiKeys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: CALL_IQS_SYSTEM_PROMPT + '\n\n' + scoringPrompt }] }],
      {},
      60_000,
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Scoring failed: ${err.message}` }, { status: 502 });
  }
  const scoringMs = Date.now() - t2;

  const { scores, reasoning, iqs, summary } = parseCallScoringResponse(scoringRaw);

  return NextResponse.json({
    ok: true,
    usedStoredTranscript: !!storedSegments,
    language,
    segments,
    interruptionCount,
    deadAirCount,
    iqs,
    scores,
    reasoning,
    summary,
    transcriptionMs,
    scoringMs,
  });
}
