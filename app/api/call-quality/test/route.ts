/**
 * POST /api/call-quality/test
 *
 * Stateless test endpoint — runs the full call quality AI pipeline and returns
 * results directly. Nothing is written to the database.
 *
 * Body: { recording_url: string, chat_transcript?: string }
 * Auth: same session-based auth as all other routes (admin / quality / tl)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  ENERGY_TONE_PROMPT,
  CALL_DISPOSITION_PROMPT,
  CALL_IQS_SYSTEM_PROMPT,
  buildCallScoringPrompt,
  parseTranscriptionResponse,
  parseCallScoringResponse,
  parseEnergyToneResponse,
  parseCallDisposition,
  insertPoorListeningFlags,
  segmentsToText,
} from '@/lib/call-quality';

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && !['quality', 'tl', 'admin'].includes(user?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { recording_url?: string; chat_transcript?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { recording_url, chat_transcript = '' } = body;
  if (!recording_url?.trim()) {
    return NextResponse.json({ error: 'recording_url is required' }, { status: 400 });
  }

  const config    = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured on this portal' }, { status: 503 });
  }

  // ── Step 1: Fetch audio ───────────────────────────────────────────────────
  let audioBase64 = '';
  let mimeType    = mimeFromUrl(recording_url);
  try {
    const res = await fetch(recording_url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching recording`);
    const ct = res.headers.get('content-type');
    if (ct) mimeType = ct.split(';')[0].trim() || mimeType;
    audioBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (err: any) {
    return NextResponse.json({ error: `Could not fetch recording: ${err.message}` }, { status: 422 });
  }

  // ── Step 2: Transcribe ───────────────────────────────────────────────────
  const t1 = Date.now();
  let transcriptionRaw: string;
  try {
    transcriptionRaw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: CALL_TRANSCRIPTION_PROMPT },
      ]}],
      undefined,
      120_000,
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Transcription failed: ${err.message}` }, { status: 502 });
  }
  const transcriptionMs = Date.now() - t1;

  const { language, segments } = parseTranscriptionResponse(transcriptionRaw);
  const interruptionCount = segments.filter(s => s.type === 'interruption').length;
  const deadAirCount      = segments.filter(s => s.type === 'dead_air').length;
  const callTranscriptText = segmentsToText(segments);

  // ── Step 2b: Energy / Tone from audio ───────────────────────────────────
  let energyScore: 'Yes' | 'No' | 'NA' = 'NA';
  let energyReasoning = '';
  try {
    const energyRaw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: ENERGY_TONE_PROMPT },
      ]}],
      undefined,
      60_000,
    );
    const et = parseEnergyToneResponse(energyRaw);
    energyScore     = et.score;
    energyReasoning = et.reasoning;
  } catch {}

  // ── Step 2c: Call disposition ────────────────────────────────────────────
  let callDisposition = '';
  let callSubDisposition = '';
  if (callTranscriptText) {
    try {
      const dispRaw = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_PROMPT + '\n\n' + callTranscriptText }] }],
        undefined,
        30_000,
      );
      const d = parseCallDisposition(dispRaw);
      callDisposition    = d.callDisposition;
      callSubDisposition = d.callSubDisposition;
    } catch {}
  }

  // ── Step 3: Text IQS scoring ─────────────────────────────────────────────
  const t2 = Date.now();
  const scoringPrompt = buildCallScoringPrompt(
    callTranscriptText,
    chat_transcript,
    'test',
    interruptionCount,
    deadAirCount,
    callDisposition,
    '',
  );

  let scoringRaw: string;
  try {
    scoringRaw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [{ text: CALL_IQS_SYSTEM_PROMPT + '\n\n' + scoringPrompt }] }],
      undefined,
      60_000,
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Scoring failed: ${err.message}` }, { status: 502 });
  }
  const scoringMs = Date.now() - t2;

  const { scores, reasoning, poorListeningSegments, iqs, summary } = parseCallScoringResponse(scoringRaw);

  // Override EnergyTone with audio-based score
  scores['EnergyTone']   = energyScore;
  reasoning['EnergyTone'] = energyReasoning || reasoning['EnergyTone'] || '';

  const finalSegments = insertPoorListeningFlags(segments, poorListeningSegments);
  const poorListeningCount = poorListeningSegments.length;

  return NextResponse.json({
    ok: true,
    language,
    segments: finalSegments,
    interruptionCount,
    deadAirCount,
    poorListeningCount,
    callDisposition,
    callSubDisposition,
    iqs,
    scores,
    reasoning,
    summary,
    transcriptionMs,
    scoringMs,
  });
}
