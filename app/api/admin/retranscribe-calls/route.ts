/**
 * POST /api/admin/retranscribe-calls
 *
 * Re-fetches audio from recording_url and runs the full transcription → disposition → chunking
 * pipeline for call_recordings rows where transcript IS NULL.
 *
 * Body:
 *   { call_id?: string }   — single call by ID (must have a recording_url)
 *   { }                    — batch: all calls today with transcript IS NULL
 *
 * Auth: admin only
 * Safe to re-run — will overwrite any existing transcript with a fresh Gemini transcription.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_DISPOSITION_CLASSIFY_PROMPT,
  CALL_CHUNK_PROMPT,
  parseTranscriptionResponse,
  parseCallDispositionClassified,
  parseCallChunks,
  segmentsToText,
} from '@/lib/call-quality';
import {
  insertCallRecording,
  updateCallRecordingMetrics,
  updateCallDisposition,
  insertCallTranscriptChunks,
  type CallRecordingRow,
} from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

function mimeFromUrl(u: string): string {
  if (u.includes('.wav'))  return 'audio/wav';
  if (u.includes('.mp4'))  return 'audio/mp4';
  if (u.includes('.m4a'))  return 'audio/mp4';
  if (u.includes('.ogg'))  return 'audio/ogg';
  if (u.includes('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

async function getPendingCalls(callId?: string): Promise<CallRecordingRow[]> {
  if (callId) {
    return query<CallRecordingRow>(
      `SELECT * FROM call_recordings WHERE id = $1 AND recording_url IS NOT NULL`,
      [callId],
    );
  }
  // All calls from today (UTC) with no transcript and a recording URL
  return query<CallRecordingRow>(
    `SELECT * FROM call_recordings
     WHERE transcript IS NULL
       AND recording_url IS NOT NULL
       AND called_at >= CURRENT_DATE
     ORDER BY called_at ASC`,
    [],
  );
}

async function transcribeCall(
  call: CallRecordingRow,
  geminiKeys: string[],
): Promise<{ disposition: string; subDisposition: string; segments: number; chunks: number }> {
  const { id: callId, recording_url: recordingUrl, contact_id, agent_id, called_at } = call;

  if (!recordingUrl) throw new Error('No recording_url');

  // Step 1: Fetch audio
  let audioBase64 = '';
  let mimeType = mimeFromUrl(recordingUrl);
  const audioRes = await fetch(recordingUrl);
  if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status} fetching audio from ${recordingUrl}`);
  const ct = audioRes.headers.get('content-type');
  if (ct) mimeType = ct.split(';')[0].trim() || mimeType;
  audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');

  // Step 2: Gemini audio transcription — 3 retries so non-English calls never silently fail
  const transcriptionContents = [{ role: 'user', parts: [
    { inlineData: { mimeType, data: audioBase64 } },
    { text: CALL_TRANSCRIPTION_PROMPT },
  ]}];
  let raw = '';
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = await geminiGenerate(geminiKeys, 'gemini-2.5-flash', transcriptionContents, {}, 120_000);
      break;
    } catch (err: any) {
      lastErr = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, 10_000 * attempt));
    }
  }
  if (!raw) throw lastErr ?? new Error('Audio transcription failed after 3 attempts');

  const { language, segments } = parseTranscriptionResponse(raw);
  const interruptionCount = segments.filter(s => s.type === 'interruption').length;
  const deadAirCount      = segments.filter(s => s.type === 'dead_air').length;

  // Step 3: Persist transcript (force-update regardless of existing value)
  await query(
    `UPDATE call_recordings
     SET language = $1, transcript = $2, interruption_count = $3, dead_air_count = $4,
         status = 'pending_link', updated_at = NOW()
     WHERE id = $5`,
    [language, JSON.stringify(segments), interruptionCount, deadAirCount, callId],
  );

  const transcriptText = segmentsToText(segments);
  let disposition = '';
  let subDisposition = '';
  let chunkCount = 0;

  if (transcriptText.trim()) {
    // Step 4: Disposition — callGeminiForCall has 5 retries + full model chain
    try {
      const rawDisp = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_CLASSIFY_PROMPT + '\n\n## CALL TRANSCRIPT\n' + transcriptText }] }],
        undefined,
        30_000,
      );
      const classified = parseCallDispositionClassified(rawDisp);
      disposition    = classified.disposition;
      subDisposition = classified.subDisposition;
      if (disposition) await updateCallDisposition(callId, disposition, subDisposition);
    } catch (err: any) {
      console.error(`[retranscribe] Disposition failed for call ${callId}:`, err.message);
    }

    // Step 5: Chunking — callGeminiForCall has 5 retries + full model chain
    try {
      const rawChunks = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_CHUNK_PROMPT + '\n\n## CALL TRANSCRIPT\n' + transcriptText }] }],
        undefined,
        30_000,
      );
      const chunks = parseCallChunks(rawChunks);
      if (chunks.length > 0) {
        // Remove any stale chunks from a previous partial run before inserting fresh ones
        await query(`DELETE FROM call_transcript_chunks WHERE call_id = $1`, [callId]);
        await insertCallTranscriptChunks(chunks.map((c, i) => ({
          callId,
          chatId: call.chat_id ?? null,
          contactId: contact_id ?? null,
          agentId: agent_id ?? null,
          calledAt: called_at ?? null,
          topic: c.topic,
          summary: c.summary,
          content: c.content,
          chunkIndex: i,
        })));
        chunkCount = chunks.length;
      }
    } catch (err: any) {
      console.error(`[retranscribe] Chunking failed for call ${callId}:`, err.message);
    }
  }

  return { disposition, subDisposition, segments: segments.length, chunks: chunkCount };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  let body: { call_id?: string } = {};
  try { body = await req.json(); } catch {}

  const callId = body.call_id?.trim() || undefined;

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

  const calls = await getPendingCalls(callId);
  if (!calls.length) {
    const reason = callId
      ? `Call ${callId} not found or has no recording_url`
      : 'No calls today with null transcript and a recording_url';
    return NextResponse.json({ ok: true, message: reason, processed: 0 });
  }

  const results: Array<{
    callId: string;
    segments?: number;
    disposition?: string;
    subDisposition?: string;
    chunks?: number;
    error?: string;
  }> = [];

  for (const call of calls) {
    try {
      const r = await transcribeCall(call, geminiKeys);
      console.log(`[retranscribe] call ${call.id} — ${r.segments} segments, disposition=${r.disposition}, chunks=${r.chunks}`);
      results.push({ callId: call.id, ...r });
    } catch (err: any) {
      console.error(`[retranscribe] call ${call.id} failed:`, err.message);
      results.push({ callId: call.id, error: err.message });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: calls.length,
    succeeded: results.filter(r => !r.error).length,
    failed: results.filter(r => r.error).length,
    results,
  });
}

// GET: preview how many calls today have null transcript
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const rows = await query<{ count: string; ids: string[] }>(`
    SELECT COUNT(*)::text AS count,
           ARRAY_AGG(id ORDER BY called_at ASC) AS ids
    FROM call_recordings
    WHERE transcript IS NULL
      AND recording_url IS NOT NULL
      AND called_at >= CURRENT_DATE
  `, []);

  return NextResponse.json({
    ok: true,
    pendingCount: parseInt(rows[0]?.count ?? '0', 10),
    callIds: rows[0]?.ids ?? [],
  });
}
