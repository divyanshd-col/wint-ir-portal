/**
 * POST /api/call-quality/unified-score
 *
 * Runs chat IQS + call IQS scoring in one shot.
 * Steps:
 *   1. Fetch chat transcript from DB
 *   2. Fetch + transcribe call audio (Gemini)
 *   3. Retrieve KB chunks for both transcripts
 *   4. Score chat (lib/quality) + call (lib/call-quality) in parallel
 *   5. Return both scores + merged timeline
 *
 * Body: { chat_id: string, recording_url: string }
 * Auth: admin / quality / tl
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { getConversation } from '@/lib/robylon/db';
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
  type CallSegment,
} from '@/lib/call-quality';
import {
  IQS_SYSTEM_PROMPT,
  buildScoringPrompt,
  parseScoringResponse,
  trimTranscript,
} from '@/lib/quality';

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function chatMessagesToText(messages: any[]): string {
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

/** Build a merged timeline: interleave call segments and chat messages by timestamp */
function buildMergedTimeline(
  callSegments: CallSegment[],
  chatMessages: any[],
  chatStartedAt: string | null,
  callCalledAt: string | null,
): Array<{ source: 'call' | 'chat'; ts?: string; data: any }> {
  const items: Array<{ source: 'call' | 'chat'; ts?: string; sortKey: number; data: any }> = [];

  // Chat messages — use message timestamp if available, else space from chat start
  const chatBase = chatStartedAt ? new Date(chatStartedAt).getTime() : 0;
  chatMessages.forEach((m, i) => {
    const ts = m.created_at || m.timestamp;
    const sortKey = ts ? new Date(ts).getTime() : chatBase + i * 1000;
    items.push({ source: 'chat', ts: ts || undefined, sortKey, data: m });
  });

  // Call segments — use callCalledAt as base; segments are sequential
  const callBase = callCalledAt ? new Date(callCalledAt).getTime() : Date.now();
  callSegments.forEach((seg, i) => {
    items.push({ source: 'call', sortKey: callBase + i * 500, data: seg });
  });

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items.map(({ source, ts, data }) => ({ source, ts, data }));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && !['quality', 'tl', 'admin'].includes(user?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { chat_id?: string; recording_url?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { chat_id, recording_url } = body;
  if (!chat_id?.trim())       return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  if (!recording_url?.trim()) return NextResponse.json({ error: 'recording_url is required' }, { status: 400 });

  const recordingUrl = recording_url.trim();
  const chatId       = chat_id.trim();

  const t0 = Date.now();

  // ── Config ────────────────────────────────────────────────────────────────
  let geminiKeys: string[];
  try {
    const config = await readConfig();
    geminiKeys   = getIQSGeminiKeys(config);
  } catch (err: any) {
    return NextResponse.json({ error: `Config error: ${err.message}` }, { status: 500 });
  }
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 503 });
  }

  // ── Fetch chat conversation ───────────────────────────────────────────────
  let chatConv: any = null;
  try { chatConv = await getConversation(chatId); } catch {}

  const chatMessages: any[] = Array.isArray(chatConv?.transcript) ? chatConv.transcript
    : Array.isArray((chatConv?.transcript as any)?.messages) ? (chatConv.transcript as any).messages
    : [];
  const chatTranscriptRaw = chatMessagesToText(chatMessages);
  const chatTranscriptTrimmed = trimTranscript(chatTranscriptRaw, 5000);
  const chatDisposition = [
    (chatConv?.tags as any)?.disposition || '',
    (chatConv?.tags as any)?.sub_disposition || '',
  ].filter(Boolean).join(' > ');

  // ── Fetch audio ───────────────────────────────────────────────────────────
  let audioBase64 = '';
  let mimeType    = mimeFromUrl(recordingUrl);
  try {
    const res = await fetch(recordingUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type');
    if (ct) mimeType = ct.split(';')[0].trim() || mimeType;
    audioBase64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (err: any) {
    return NextResponse.json({ error: `Could not fetch recording: ${err.message}` }, { status: 422 });
  }

  // ── Transcribe call ───────────────────────────────────────────────────────
  const tTranscribe = Date.now();
  let callSegments: CallSegment[] = [];
  let language = 'English';
  let interruptionCount = 0;
  let deadAirCount = 0;
  let transcriptionMs = 0;

  try {
    const raw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: CALL_TRANSCRIPTION_PROMPT },
      ]}],
      undefined, 120_000,
    );
    transcriptionMs = Date.now() - tTranscribe;
    const parsed = parseTranscriptionResponse(raw);
    callSegments      = parsed.segments;
    language          = parsed.language;
    interruptionCount = callSegments.filter(s => s.type === 'interruption').length;
    deadAirCount      = callSegments.filter(s => s.type === 'dead_air').length;
  } catch (err: any) {
    return NextResponse.json({ error: `Transcription failed: ${err.message}` }, { status: 502 });
  }

  const callTranscriptText = segmentsToText(callSegments);

  // ── Energy / Tone (audio-based) ───────────────────────────────────────────
  let energyScore: 'Yes' | 'No' | 'NA' = 'NA';
  let energyReasoning = '';
  try {
    const raw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: ENERGY_TONE_PROMPT },
      ]}],
      undefined, 60_000,
    );
    const et = parseEnergyToneResponse(raw);
    energyScore     = et.score;
    energyReasoning = et.reasoning;
  } catch {}

  // ── Call disposition ──────────────────────────────────────────────────────
  let callDisposition = '';
  let callSubDisposition = '';
  if (callTranscriptText) {
    try {
      const raw = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_PROMPT + '\n\n' + callTranscriptText }] }],
        undefined, 30_000,
      );
      const d = parseCallDisposition(raw);
      callDisposition    = d.callDisposition;
      callSubDisposition = d.callSubDisposition;
    } catch {}
  }

  // ── KB chunks (shared for both scorers) ──────────────────────────────────
  let kbContext = '';
  const kbQuery = callDisposition || chatDisposition;
  if (kbQuery) {
    try {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, kbQuery, 5);
      if (relevant.length) kbContext = relevant.map(c => `[${c.fileName}]\n${c.content}`).join('\n---\n');
    } catch {}
  }

  // ── Score BOTH in parallel ────────────────────────────────────────────────
  const tScore = Date.now();

  const [chatScoringRaw, callScoringRaw] = await Promise.allSettled([
    // Chat IQS
    callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [{ text: IQS_SYSTEM_PROMPT + '\n\n' + buildScoringPrompt(
        chatTranscriptTrimmed,
        chatDisposition.split(' > ')[0] || '',
        chatId,
        '',
        kbContext,
        chatDisposition.split(' > ')[1] || '',
        chatConv?.conversation_type,
      )}] }],
      undefined, 60_000,
    ),
    // Call IQS
    callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [{ text: CALL_IQS_SYSTEM_PROMPT + '\n\n' + buildCallScoringPrompt(
        callTranscriptText,
        chatTranscriptRaw,
        chatId,
        interruptionCount,
        deadAirCount,
        callDisposition,
        chatDisposition,
        kbContext,
      )}] }],
      undefined, 60_000,
    ),
  ]);

  const scoringMs = Date.now() - tScore;

  // ── Parse chat score ──────────────────────────────────────────────────────
  let chatResult: any = null;
  if (chatScoringRaw.status === 'fulfilled') {
    try {
      chatResult = parseScoringResponse(chatScoringRaw.value, chatId, chatConv?.conversation_type);
    } catch {}
  }

  // ── Parse call score ──────────────────────────────────────────────────────
  let callResult: any = null;
  if (callScoringRaw.status === 'fulfilled') {
    try {
      callResult = parseCallScoringResponse(callScoringRaw.value);
      // Override EnergyTone with audio score — not in 12-param set but keep for compat
      if (callResult.scores) {
        callResult.scores['EnergyTone']    = energyScore;
        callResult.reasoning['EnergyTone'] = energyReasoning || callResult.reasoning['EnergyTone'] || '';
      }
      const finalSegs = insertPoorListeningFlags(callSegments, callResult.poorListeningSegments || []);
      callResult.segments = finalSegs;
    } catch {}
  }

  // ── Merged timeline ───────────────────────────────────────────────────────
  const mergedTimeline = buildMergedTimeline(
    callResult?.segments ?? callSegments,
    chatMessages,
    chatConv?.started_at ?? null,
    null,
  );

  const totalMs = Date.now() - t0;

  return NextResponse.json({
    ok: true,
    chat_id: chatId,
    chatDisposition,
    callDisposition,
    callSubDisposition,
    language,
    interruptionCount,
    deadAirCount,
    // Chat scoring
    chatIqs:       chatResult?.iqs ?? null,
    chatScores:    chatResult?.scores ?? {},
    chatReasoning: chatResult?.reasoning ?? {},
    chatSummary:   chatResult?.summary ?? '',
    // Call scoring
    callIqs:         callResult?.iqs ?? null,
    callScores:      callResult?.scores ?? {},
    callReasoning:   callResult?.reasoning ?? {},
    callSummary:     callResult?.summary ?? '',
    callSegments:    callResult?.segments ?? callSegments,
    poorListeningCount: (callResult?.poorListeningSegments ?? []).length,
    // Merged view
    mergedTimeline,
    // Timing
    transcriptionMs,
    scoringMs,
    totalMs,
  });
}
