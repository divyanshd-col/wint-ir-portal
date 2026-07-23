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
import { geminiGenerate, callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import {
  getConversation,
  getAllCallRecordingsByChatId,
  getCallRecordingsByConversationContact,
  getCallRecordingsByContactWindow,
  linkCallToChat,
} from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';
import { scoreLinkedCallsForChat } from '@/lib/scoring/engine';
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
  getSystemPrompt,
  buildScoringPrompt,
  parseScoringResponse,
  robustJsonParse,
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
  recordingMeta: Array<{ calledAt: string | null; durationSeconds: number | null; segmentCount: number }>,
): Array<{ source: 'call' | 'chat' | 'call-boundary'; ts?: string; data: any }> {
  const items: Array<{ source: 'call' | 'chat' | 'call-boundary'; ts?: string; sortKey: number; data: any }> = [];

  // Parse "M:SS" or "MM:SS" or "H:MM:SS" relative timestamp → milliseconds offset
  function parseTsToMs(ts: string): number | null {
    const parts = ts.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    return null;
  }

  const chatBase = chatStartedAt ? new Date(chatStartedAt).getTime() : 0;
  chatMessages.forEach((m, i) => {
    const ts = m.created_at || m.timestamp;
    const sortKey = ts ? new Date(ts).getTime() : chatBase + i * 1000;
    items.push({ source: 'chat', ts: ts || undefined, sortKey, data: m });
  });

  // Compute the latest timestamp seen across all chat messages so that calls
  // with a NULL called_at can be placed safely after all chat activity.
  const lastChatTs = chatMessages.reduce((max, m) => {
    const ts = m.created_at || m.timestamp;
    const t  = ts ? new Date(ts).getTime() : 0;
    return t > max ? t : max;
  }, chatBase);

  const totalCalls = recordingMeta.length;
  let segOffset = 0;
  // Track estimated end of previous call so NULL-called_at calls chain correctly.
  let prevCallEnd = lastChatTs + 60_000;
  for (let recIdx = 0; recIdx < totalCalls; recIdx++) {
    const rec      = recordingMeta[recIdx];
    // When called_at is NULL, place this call after last known chat/call activity.
    const callBase = rec.calledAt ? new Date(rec.calledAt).getTime() : prevCallEnd;
    const count    = rec.segmentCount;
    const callLabel = totalCalls > 1 ? `Call ${recIdx + 1}` : 'Call';

    // Compute call end: prefer duration_seconds, then last real segment ts, then conservative estimate
    const segsForRec = callSegments.slice(segOffset, segOffset + count);
    const lastSegTs  = [...segsForRec].reverse().find(s => s.ts)?.ts;
    const lastSegMs  = lastSegTs ? parseTsToMs(lastSegTs) : null;
    const durationMs = rec.durationSeconds
      ? rec.durationSeconds * 1000
      : lastSegMs !== null
        ? lastSegMs + 5000
        : Math.max(count * 3, 60) * 1000;  // 3s/segment — conservative fallback
    const callEnd = callBase + durationMs;

    items.push({
      source: 'call-boundary',
      sortKey: callBase - 1,
      data: { label: `📞 ${callLabel} started`, calledAt: rec.calledAt, kind: 'start' },
    });

    for (let i = 0; i < count; i++) {
      const seg = segsForRec[i];
      if (!seg) continue;
      // Use real timestamp from Gemini if present, otherwise fall back to proportional estimate
      const offsetMs = seg.ts ? parseTsToMs(seg.ts) : null;
      const sortKey  = offsetMs !== null
        ? callBase + offsetMs
        : callBase + (count > 1 ? (i / (count - 1)) : 0) * durationMs;
      items.push({ source: 'call', sortKey, data: seg });
    }
    segOffset += count;

    items.push({
      source: 'call-boundary',
      sortKey: callEnd + 1,
      data: { label: `📞 ${callLabel} ended`, calledAt: rec.calledAt, kind: 'end' },
    });

    // Update so next NULL-called_at call chains after this one
    prevCallEnd = callEnd + 60_000;
  }

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
  let config: Awaited<ReturnType<typeof readConfig>>;
  try {
    config     = await readConfig();
    geminiKeys = getIQSGeminiKeys(config);
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
  // Three-stage lookup to handle Robylon's separate ticket IDs per channel:
  //   Stage 1: chat_id direct match (recording already linked to this ticket)
  //   Stage 2: sibling-conversation join — find recordings whose chat_id points to
  //            a conversation sharing the same contact_id as this chat (e.g. call
  //            ticket 38252 and WhatsApp ticket 38007 both belong to same contact)
  //   Stage 3: contact_id + time window (fallback if call_recordings.chat_id is NULL)
  let callSegments: CallSegment[] = [];
  let language = '';
  let interruptionCount = 0;
  let deadAirCount = 0;
  let callCalledAt: string | null = null;
  let hasCallRecording = false;
  let callRecordingCount = 0;
  const recordingMeta: Array<{ calledAt: string | null; durationSeconds: number | null; segmentCount: number }> = [];
  const perCallRecordings: Array<{
    id: string;
    calledAt: string | null;
    durationSeconds: number | null;
    recordingUrl: string | null;
    segments: CallSegment[];
    interruptionCount: number;
    deadAirCount: number;
  }> = [];

  function parseRecordingSegments(rec: any): CallSegment[] {
    if (!rec.transcript) return [];
    const t = typeof rec.transcript === 'string' ? JSON.parse(rec.transcript) : rec.transcript;
    return Array.isArray(t.segments) ? t.segments : Array.isArray(t) ? t : [];
  }

  try {
    // Run ALL three stages and merge results, deduplicating by recording ID.
    // This handles chats with multiple calls (e.g. chat 51462 → calls 52883 + 52885).
    const seenIds = new Set<string>();
    const allRecs: any[] = [];

    function addRecs(rows: any[]) {
      for (const r of rows) {
        if (r?.id && !seenIds.has(String(r.id))) {
          seenIds.add(String(r.id));
          allRecs.push(r);
        }
      }
    }

    // Stage 1: all recordings directly linked to this chat_id
    try { addRecs(await getAllCallRecordingsByChatId(chatId)); } catch {}

    // Stage 2: sibling-conversation join (separate Robylon ticket per channel)
    try { addRecs(await getCallRecordingsByConversationContact(chatId)); } catch {}

    // Stage 3: contact_id + time window (chat_id=NULL recordings)
    if (chatConv?.contact_id) {
      const windowStart = chatConv.started_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const windowEnd   = chatConv.closed_at  ?? new Date().toISOString();
      try { addRecs(await getCallRecordingsByContactWindow(chatConv.contact_id, windowStart, windowEnd)); } catch {}
    }

    // Sort by called_at so segments are in chronological order across multiple calls
    allRecs.sort((a, b) => {
      if (!a.called_at) return 1;
      if (!b.called_at) return -1;
      return new Date(a.called_at).getTime() - new Date(b.called_at).getTime();
    });

    let needsScoring = false;
    for (const r of allRecs) {
      let isTranscribed = false;
      if (r.transcript) {
        try {
          const parsed = typeof r.transcript === 'string' ? JSON.parse(r.transcript) : r.transcript;
          isTranscribed = Array.isArray(parsed) && parsed.length > 0;
        } catch {}
      }
      if (r.chat_id !== chatId) {
        if (!r.chat_id) {
          await linkCallToChat(r.id, chatId);
        }
        if (!isTranscribed && r.recording_url) {
          needsScoring = true;
        }
      } else {
        if (!isTranscribed && r.recording_url) {
          await query(`UPDATE call_recordings SET status = 'linked' WHERE id = $1`, [r.id]);
          needsScoring = true;
        }
      }
    }

    if (needsScoring) {
      const tags = chatConv?.tags || {};
      await scoreLinkedCallsForChat(chatId, chatTranscriptRaw, tags.disposition || '', tags.sub_disposition || '', config);
      
      // Re-fetch call recordings after they have been transcribed and scored
      allRecs.length = 0;
      seenIds.clear();
      try { addRecs(await getAllCallRecordingsByChatId(chatId)); } catch {}
      try { addRecs(await getCallRecordingsByConversationContact(chatId)); } catch {}
      if (chatConv?.contact_id) {
        const windowStart = chatConv.started_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const windowEnd   = chatConv.closed_at  ?? new Date().toISOString();
        try { addRecs(await getCallRecordingsByContactWindow(chatConv.contact_id, windowStart, windowEnd)); } catch {}
      }
      
      allRecs.sort((a, b) => {
        if (!a.called_at) return 1;
        if (!b.called_at) return -1;
        return new Date(a.called_at).getTime() - new Date(b.called_at).getTime();
      });
    }

    if (allRecs.length > 0) {
      const mergedSegs: CallSegment[] = [];
      for (const rec of allRecs) {
        const segs = parseRecordingSegments(rec);
        mergedSegs.push(...segs);
        recordingMeta.push({ calledAt: rec.called_at ?? null, durationSeconds: rec.duration_seconds ?? null, segmentCount: segs.length });
        perCallRecordings.push({
          id: String(rec.id),
          calledAt: rec.called_at ?? null,
          durationSeconds: rec.duration_seconds ?? null,
          recordingUrl: rec.recording_url ?? null,
          segments: segs,
          interruptionCount: segs.filter((s: CallSegment) => s.type === 'interruption').length,
          deadAirCount: segs.filter((s: CallSegment) => s.type === 'dead_air').length,
        });
        if (!language) {
          const t = typeof rec.transcript === 'object' ? rec.transcript : null;
          language = rec.language || t?.language || '';
        }
        if (!callCalledAt && rec.called_at) callCalledAt = rec.called_at;
      }
      callSegments       = mergedSegs;
      callRecordingCount = allRecs.length;
      interruptionCount  = callSegments.filter((s: CallSegment) => s.type === 'interruption').length;
      deadAirCount       = callSegments.filter((s: CallSegment) => s.type === 'dead_air').length;
      hasCallRecording   = callSegments.length > 0;
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
  // Use the best available signal: call disposition > chat disposition > first 400 chars of call transcript
  let kbContext = '';
  const kbQuery = callDisposition || chatDisposition || callTranscriptText.slice(0, 400);
  if (kbQuery) {
    try {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, kbQuery, 5);
      if (relevant.length) {
        const docNames = config.knowledgeBaseDocNames || {};
        const chunkLabel = (c: { fileName: string; content: string }) => {
          const driveId = c.fileName.trim();
          if (docNames[driveId]) return docNames[driveId];
          if (/^[A-Za-z0-9_-]{25,}$/.test(driveId)) {
            const firstLine = c.content.split('\n')[0].trim();
            return firstLine.length > 3 ? firstLine : 'KB Document';
          }
          return c.fileName;
        };
        kbContext = relevant.map(c => `[${chunkLabel(c)}]\n${c.content}`).join('\n---\n');
      }
    } catch {}
  }

  // ── Score BOTH in parallel ────────────────────────────────────────────────
  const tScore = Date.now();

  const scoringTasks: Promise<any>[] = [
    callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [{ text: getSystemPrompt(chatConv?.conversation_type, config.iqsScoringPrompt) + '\n\n' + buildScoringPrompt(
        chatTranscriptTrimmed,
        chatDisposition.split(' > ')[0] || '',
        chatId,
        '',
        kbContext,
        chatDisposition.split(' > ')[1] || '',
        chatConv?.conversation_type,
        false,
      )}] }],
      undefined, 60_000,
    ),
  ];

  if (hasCallRecording) {
    const combinedTranscript = `--- WHATSAPP CHAT TRANSCRIPT ---\n${chatTranscriptRaw}\n\n--- TELEPHONE CALL TRANSCRIPT ---\n${callTranscriptText}`;
    const combinedPrompt = buildScoringPrompt(
      combinedTranscript,
      chatDisposition.split(' > ')[0] || '',
      chatId,
      '',
      kbContext,
      chatDisposition.split(' > ')[1] || '',
      chatConv?.conversation_type || 'agent',
      true,
    );
    const iqsSystemPrompt = getSystemPrompt(chatConv?.conversation_type || 'agent', config.iqsScoringPrompt);
    scoringTasks.push(
      geminiGenerate(
        geminiKeys,
        'gemini-3.5-flash',
        [{ role: 'user', parts: [{ text: iqsSystemPrompt + '\n\n' + combinedPrompt }] }],
        {},
        60_000,
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
      callResult = parseScoringResponse(callScoringRaw.value, chatId, chatConv?.conversation_type);
      callResult.segments = callSegments;
    } catch {}
  }

  // Build per-call recordings with poor-listening flags applied proportionally.
  // We re-split the flagged merged segments back into per-call buckets using original counts.
  const flaggedMerged: CallSegment[] = callResult?.segments ?? callSegments;
  let segCursor = 0;
  const callRecordingsOut = perCallRecordings.map((rec, idx) => {
    const originalCount = rec.segments.length;
    // Count how many segments (including inserted poor_listening flags) belong to this recording.
    // Flags are inserted immediately after their parent speech segment, so advance until we've
    // consumed `originalCount` non-poor_listening segments.
    let consumed = 0;
    let end = segCursor;
    while (end < flaggedMerged.length && consumed < originalCount) {
      if (flaggedMerged[end].type !== 'poor_listening') consumed++;
      end++;
    }
    // Also consume any trailing poor_listening flags
    while (end < flaggedMerged.length && flaggedMerged[end].type === 'poor_listening') end++;
    const segs = flaggedMerged.slice(segCursor, end);
    segCursor = end;
    return {
      id: rec.id,
      label: perCallRecordings.length > 1 ? `Call ${idx + 1}` : 'Call',
      calledAt: rec.calledAt,
      durationSeconds: rec.durationSeconds,
      recordingUrl: rec.recordingUrl,
      segments: segs,
      interruptionCount: rec.interruptionCount,
      deadAirCount: rec.deadAirCount,
    };
  });

  const mergedTimeline = buildMergedTimeline(
    callResult?.segments ?? callSegments,
    chatMessages,
    chatConv?.started_at ?? null,
    recordingMeta.length > 0 ? recordingMeta : [{ calledAt: callCalledAt, durationSeconds: null, segmentCount: (callResult?.segments ?? callSegments).length }],
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
    chatKbCitation:     chatResult?.kbCitation ?? null,
    callIqs:            callResult?.iqs ?? null,
    callScores:         callResult?.scores ?? {},
    callReasoning:      callResult?.reasoning ?? {},
    callSummary:        callResult?.summary ?? '',
    callKbCitation:     callResult?.kbCitation ?? null,
    callSegments:       flaggedMerged,
    callRecordings:     callRecordingsOut,
    poorListeningCount: (callResult?.poorListeningSegments ?? []).length,
    mergedTimeline,
    scoringMs,
    totalMs: Date.now() - t0,
  });
}
