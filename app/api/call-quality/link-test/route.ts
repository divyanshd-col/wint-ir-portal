/**
 * POST /api/call-quality/link-test
 *
 * Manual test endpoint — links a call_recording row to a WhatsApp chat and
 * runs the full scoring pipeline, returning the full result.
 * Use this to verify the end-to-end pipeline with a specific call_id + chat_id.
 *
 * Body: { call_id: string, chat_id: string }
 * Auth: admin / quality / tl
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
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
import {
  getCallRecording,
  getConversation,
  insertCallRecording,
  updateCallRecordingMetrics,
  updateCallIQSScore,
  updateCallRecordingStatus,
  linkCallToChat,
  type IQSParameterResult,
} from '@/lib/robylon/db';

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function transcriptFromJsonb(messages: any[]): string {
  if (!Array.isArray(messages)) return '';
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.sender_type === 'customer' ? 'Customer'
               : m.sender_type === 'bot'      ? 'Bot'
               : 'Agent';
    const content = (m.content || '').trim();
    if (content) lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && !['quality', 'tl', 'admin'].includes(user?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { call_id?: string; chat_id?: string; recording_url?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { call_id, chat_id, recording_url } = body;
  if (!call_id?.trim())       return NextResponse.json({ error: 'call_id is required' }, { status: 400 });
  if (!chat_id?.trim())       return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  if (!recording_url?.trim()) return NextResponse.json({ error: 'recording_url is required' }, { status: 400 });

  const recordingUrl = recording_url.trim();

  // ── Load Gemini config ─────────────────────────────────────────────────────
  let config: any, geminiKeys: string[];
  try {
    config     = await readConfig();
    geminiKeys = getIQSGeminiKeys(config);
  } catch (err: any) {
    return NextResponse.json({ error: `Config error: ${err.message}` }, { status: 500 });
  }
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 503 });
  }

  // ── Load chat transcript from DB (optional — skip gracefully if unavailable) ─
  let chatConv: any = null;
  try {
    chatConv = await getConversation(chat_id.trim());
  } catch { /* chat context unavailable — continue without it */ }

  // ── Fetch audio (needed for transcription and energy/tone) ─────────────────
  let audioBase64 = '';
  let mimeType    = mimeFromUrl(recordingUrl);
  const t0 = Date.now();
  try {
    const res = await fetch(recordingUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching audio`);
    const ct = res.headers.get('content-type');
    if (ct) mimeType = ct.split(';')[0].trim() || mimeType;
    audioBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (err: any) {
    return NextResponse.json({ error: `Could not fetch recording: ${err.message}` }, { status: 422 });
  }

  // ── Pass 1: Transcription (always fresh from provided URL) ───────────────
  const t1 = Date.now();
  let segments: any[];
  let language = 'English';
  let interruptionCount = 0;
  let deadAirCount      = 0;
  let transcriptionMs = 0;

  try {
    const raw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: CALL_TRANSCRIPTION_PROMPT },
      ]}],
      undefined,
      120_000,
    );
    transcriptionMs = Date.now() - t1;
    const parsed = parseTranscriptionResponse(raw);
    segments         = parsed.segments;
    language         = parsed.language;
    interruptionCount = segments.filter((s: any) => s.type === 'interruption').length;
    deadAirCount      = segments.filter((s: any) => s.type === 'dead_air').length;
  } catch (err: any) {
    return NextResponse.json({ error: `Transcription failed: ${err.message}` }, { status: 502 });
  }

  const callTranscriptText = segmentsToText(segments);

  // ── Pass 1b: Energy / Tone from audio ─────────────────────────────────────
  let energyScore: 'Yes' | 'No' | 'NA' = 'NA';
  let energyReasoning = '';
  try {
    const raw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: ENERGY_TONE_PROMPT },
      ]}],
      undefined,
      60_000,
    );
    const et = parseEnergyToneResponse(raw);
    energyScore     = et.score;
    energyReasoning = et.reasoning;
  } catch {}

  // ── Call disposition extraction ────────────────────────────────────────────
  let callDisposition = '';
  let callSubDisposition = '';
  if (callTranscriptText) {
    try {
      const raw = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_PROMPT + '\n\n' + callTranscriptText }] }],
        undefined,
        30_000,
      );
      const d = parseCallDisposition(raw);
      callDisposition    = d.callDisposition;
      callSubDisposition = d.callSubDisposition;
    } catch {}
  }

  // ── Chat transcript for context ────────────────────────────────────────────
  let chatTranscriptText = '';
  let chatDisposition = '';
  if (chatConv) {
    const msgs = Array.isArray(chatConv.transcript) ? chatConv.transcript
               : Array.isArray((chatConv.transcript as any)?.messages) ? (chatConv.transcript as any).messages
               : [];
    chatTranscriptText = transcriptFromJsonb(msgs);
    chatDisposition = [
      (chatConv.tags as any)?.disposition || '',
      (chatConv.tags as any)?.sub_disposition || '',
    ].filter(Boolean).join(' > ');
  }

  // ── KB context ────────────────────────────────────────────────────────────
  let kbContext = '';
  const kbQuery = callDisposition || chatDisposition;
  if (kbQuery) {
    try {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, kbQuery, 5);
      if (relevant.length) kbContext = relevant.map(c => `[${c.fileName}]\n${c.content}`).join('\n---\n');
    } catch {}
  }

  // ── Pass 2: Text IQS scoring ──────────────────────────────────────────────
  const t2 = Date.now();
  const scoringPrompt = buildCallScoringPrompt(
    callTranscriptText,
    chatTranscriptText,
    call_id,
    interruptionCount,
    deadAirCount,
    callDisposition,
    chatDisposition,
    kbContext,
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
  scores['EnergyTone']    = energyScore;
  reasoning['EnergyTone'] = energyReasoning || reasoning['EnergyTone'] || '';

  const finalSegments    = insertPoorListeningFlags(segments, poorListeningSegments);
  const poorListeningCount = poorListeningSegments.length;

  // ── Persist results to DB ─────────────────────────────────────────────────
  let dbError: string | null = null;
  try {
    await linkCallToChat(call_id, chat_id);
    await insertCallRecording({ id: call_id, chatId: chat_id, transcript: finalSegments, language });

    const parameters: Record<string, IQSParameterResult> = {};
    for (const [key, val] of Object.entries(scores)) {
      parameters[key] = {
        score: val === 'Yes' ? true : val === 'No' ? false : null,
        reasoning: reasoning[key] || '',
      };
    }

    await updateCallIQSScore({
      chatId: chat_id,
      callIqsScore: iqs,
      callParameters: parameters,
      callModelVersion: 'gemini-2.5-flash-preview-05-20',
    });
    await updateCallRecordingStatus(call_id, 'scored');
  } catch (err: any) {
    dbError = err.message;
    console.error('[link-test] DB persist error:', err.message);
  }

  const totalMs = Date.now() - t0;

  console.log(`[link-test] call ${call_id} → chat ${chat_id} | IQS ${iqs} | ${totalMs}ms`);

  return NextResponse.json({
    ok: true,
    call_id,
    chat_id,
    language,
    segments: finalSegments,
    interruptionCount,
    deadAirCount,
    poorListeningCount,
    callDisposition,
    callSubDisposition,
    chatDisposition,
    iqs,
    scores,
    reasoning,
    summary,
    transcriptionMs,
    scoringMs,
    totalMs,
    ...(dbError ? { dbWarning: `Scoring succeeded but DB save failed: ${dbError}` } : {}),
  });
}
