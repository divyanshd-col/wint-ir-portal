/**
 * POST /api/call-quality/test
 *
 * Test endpoint — no DB writes.
 * Accepts a recording URL + optional chat transcript, runs Gemini
 * transcription + IQS scoring, and returns the full result as JSON.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_IQS_SYSTEM_PROMPT,
  parseTranscriptionResponse,
  segmentsToText,
  buildCallScoringPrompt,
  parseCallScoringResponse,
} from '@/lib/call-quality';

export const runtime    = 'nodejs';
export const maxDuration = 180;

const MIME_MAP: Record<string, string> = {
  mp3:  'audio/mpeg',
  wav:  'audio/wav',
  m4a:  'audio/mp4',
  ogg:  'audio/ogg',
  flac: 'audio/flac',
  aac:  'audio/aac',
  webm: 'audio/webm',
};

function detectMime(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'audio/mpeg';
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user    = session?.user as any;
  if (!user || (!user.isAdmin && !['quality', 'tl'].includes(user?.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { recording_url?: string; chat_transcript?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { recording_url, chat_transcript = '' } = body;
  if (!recording_url) {
    return NextResponse.json({ error: 'recording_url is required' }, { status: 400 });
  }

  const config = await readConfig();
  const keys   = getIQSGeminiKeys(config);
  if (!keys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 500 });
  }

  // ── Step 1: Fetch audio and transcribe ──────────────────────────────────────
  const t0 = Date.now();

  let audioBase64: string;
  let mimeType: string;
  try {
    const audioRes = await fetch(recording_url, { signal: AbortSignal.timeout(60_000) });
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch recording (HTTP ${audioRes.status})` },
        { status: 502 },
      );
    }
    const buffer  = await audioRes.arrayBuffer();
    audioBase64   = Buffer.from(buffer).toString('base64');
    mimeType      = audioRes.headers.get('content-type')?.split(';')[0] ?? detectMime(recording_url);
  } catch (err: any) {
    return NextResponse.json({ error: `Audio fetch error: ${err.message}` }, { status: 502 });
  }

  let transcriptionRaw: string;
  try {
    transcriptionRaw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [
        {
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: CALL_TRANSCRIPTION_PROMPT },
          ],
        },
      ],
      {},
      120_000,
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Transcription failed: ${err.message}` },
      { status: 502 },
    );
  }

  const transcriptionMs = Date.now() - t0;
  const { language, segments } = parseTranscriptionResponse(transcriptionRaw);

  const interruptionCount = segments.filter(s => s.event_type === 'interruption').length;
  const deadAirCount      = segments.filter(s => s.event_type === 'dead_air').length;

  // ── Step 2: Score call IQS ──────────────────────────────────────────────────
  const t1 = Date.now();

  const callTranscriptText = segmentsToText(segments);
  const scoringPrompt      = buildCallScoringPrompt(
    callTranscriptText,
    chat_transcript,
    'test',
    interruptionCount,
    deadAirCount,
  );

  let scoringRaw: string;
  try {
    scoringRaw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ parts: [{ text: scoringPrompt }] }],
      { systemInstruction: CALL_IQS_SYSTEM_PROMPT },
      60_000,
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Scoring failed: ${err.message}` },
      { status: 502 },
    );
  }

  const scoringMs = Date.now() - t1;
  const { scores, reasoning, iqs, summary } = parseCallScoringResponse(scoringRaw);

  return NextResponse.json({
    ok: true,
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
