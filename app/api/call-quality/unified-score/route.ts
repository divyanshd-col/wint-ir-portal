/**
 * POST /api/call-quality/unified-score
 *
 * Scores chat + call in one shot using stored transcripts — no audio URL needed.
 * Steps:
 *   1. Fetch chat transcript from DB (conversations table)
 *   2. Fetch call transcript from DB (call_recordings table, linked by chat_id)
 *   3. Retrieve KB chunks for TechnicalLegal + chat scoring
 *   4. Score chat (lib/quality) + call (lib/call-quality) in parallel
 *   5. Return both scores + merged timeline
 *
 * Body: { chat_id: string }
 * Auth: admin / quality / tl
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { getConversation, getCallRecordingByChatId, getCallRecordingsByContactWindow } from '@/lib/robylon/db';
import {
  CALL_DISPOSITION_PROMPT,
  CALL_IQS_SYSTEM_PROMPT,
  buildCallScoringPrompt,
  parseCallScoringResponse,
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

function buildMergedTimeline(
  callSegments: CallSegment[],
  chatMessages: any[],
  chatStartedAt: string | null,
  callCalledAt: string | null,
): Array<{ source: 'call' | 'chat'; ts?: string; data: any }> {
  const items: Array<{ source: 'call' | 'chat'; ts?: string; sortKey: number; data: any }> = [];

  const chatBase = chatStartedAt ? new Date(chatStartedAt).getTime() : 0;
  chatMessages.forEach((m, i) => {
    const ts = m.created_at || m.timestamp;
    const sortKey = ts ? new Date(ts).getTime() : chatBase + i * 1000;
    items.push({ source: 'chat', ts: ts || undefined, sortKey, data: m });
  });

  const callBase = callCalledAt ? new Date(callCalledAt).getTime() : (chatBase || Date.now());
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

  let body: { chat_id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { chat_id } = body;
  if (!chat_id?.trim()) return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });

  const chatId = chat_id.trim();
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
  const chatTranscriptRaw     = chatMessagesToText(chatMessages);
  const chatTranscriptTrimmed = trimTranscript(chatTranscriptRaw, 5000);
  const chatDisposition = [
    (chatConv?.tags as any)?.disposition || '',
    (chatConv?.tags as any)?.sub_disposition || '',
  ].filter(Boolean).join(' > ');

  // ── Fetch call recording transcript(s) from DB ────────────────────────────
  // Stage 1: direct chat_id match (call already linked to this WhatsApp ticket)
  // Stage 2: contact + time window fallback (Robylon creates separate ticket IDs
  //   for WhatsApp chat and voice call for the same phone number, so we match
  //   via shared contact_id + overlapping called_at timestamps)
  let callSegments: CallSegment[] = [];
  let language = '';
  let interruptionCount = 0;
  let deadAirCount = 0;
  let callCalledAt: string | null = null;
  let hasCallRecording = false;
  let callRecordingCount = 0;

  function parseRecordingSegments(rec: any): CallSegment[] {
    if (!rec.transcript) return [];
    const t = typeof rec.transcript === 'string' ? JSON.parse(rec.transcript) : rec.transcript;
    return Array.isArray(t.segments) ? t.segments : Array.isArray(t) ? t : [];
  }

  try {
    // Stage 1: direct match
    let recs: any[] = [];
    const direct = await getCallRecordingByChatId(chatId);
    if (direct) {
      recs = [direct];
    } else if (chatConv?.contact_id) {
      // Stage 2: contact window fallback
      const windowStart = chatConv.started_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const windowEnd   = chatConv.closed_at  ?? new Date().toISOString();
      recs = await getCallRecordingsByContactWindow(chatConv.contact_id, windowStart, windowEnd);
    }

    if (recs.length > 0) {
      // Merge all recordings in chronological order
      const allSegs: CallSegment[] = [];
      for (const rec of recs) {
        const segs = parseRecordingSegments(rec);
        allSegs.push(...segs);
        if (!language && (rec.language || (typeof rec.transcript === 'object' && rec.transcript?.language))) {
          language = rec.language || rec.transcript?.language || '';
        }
        if (!callCalledAt && rec.called_at) callCalledAt = rec.called_at;
      }
      callSegments      = allSegs;
      callRecordingCount = recs.length;
      interruptionCount = callSegments.filter((s: CallSegment) => s.type === 'interruption').length;
      deadAirCount      = callSegments.filter((s: CallSegment) => s.type === 'dead_air').length;
      hasCallRecording  = callSegments.length > 0;
    }
  } catch {}

  const callTranscriptText = segmentsToText(callSegments);

  // ── Call disposition (from stored transcript) ─────────────────────────────
  let callDisposition = '';
  let callSubDisposition = '';
  if (callTranscriptText) {
    try {
      const raw = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_PROMPT + '\n\n' + callTranscriptText }] }],
        undefined, 30_000,
      );
      const d        = parseCallDisposition(raw);
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

  const scoringTasks: Promise<any>[] = [
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
  ];

  if (hasCallRecording) {
    scoringTasks.push(
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
    );
  }

  const [chatScoringRaw, callScoringRaw] = await Promise.allSettled(scoringTasks);
  const scoringMs = Date.now() - tScore;

  // ── Parse results ─────────────────────────────────────────────────────────
  let chatResult: any = null;
  if (chatScoringRaw.status === 'fulfilled') {
    try { chatResult = parseScoringResponse(chatScoringRaw.value, chatId, chatConv?.conversation_type); } catch {}
  }

  let callResult: any = null;
  if (callScoringRaw && callScoringRaw.status === 'fulfilled') {
    try {
      callResult = parseCallScoringResponse(callScoringRaw.value);
      callResult.segments = insertPoorListeningFlags(callSegments, callResult.poorListeningSegments || []);
    } catch {}
  }

  const mergedTimeline = buildMergedTimeline(
    callResult?.segments ?? callSegments,
    chatMessages,
    chatConv?.started_at ?? null,
    callCalledAt,
  );

  return NextResponse.json({
    ok: true,
    chat_id: chatId,
    hasCallRecording,
    callRecordingCount,
    chatDisposition,
    callDisposition,
    callSubDisposition,
    language,
    interruptionCount,
    deadAirCount,
    chatIqs:            chatResult?.iqs ?? null,
    chatScores:         chatResult?.scores ?? {},
    chatReasoning:      chatResult?.reasoning ?? {},
    chatSummary:        chatResult?.summary ?? '',
    callIqs:            callResult?.iqs ?? null,
    callScores:         callResult?.scores ?? {},
    callReasoning:      callResult?.reasoning ?? {},
    callSummary:        callResult?.summary ?? '',
    callSegments:       callResult?.segments ?? callSegments,
    poorListeningCount: (callResult?.poorListeningSegments ?? []).length,
    mergedTimeline,
    scoringMs,
    totalMs: Date.now() - t0,
  });
}
