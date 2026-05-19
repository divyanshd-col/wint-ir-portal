/**
 * POST /api/admin/retranscribe-call
 *
 * Re-runs the full transcription → disposition → chunking pipeline for a
 * specific call_recordings row whose transcript is NULL (e.g. Vercel killed
 * the background job before it completed).
 *
 * Body: { call_id: string }
 *
 * Auth: admin only
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
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
} from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

function mimeFromUrl(u: string): string {
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
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

  const callId = body.call_id?.trim();
  if (!callId) {
    return NextResponse.json({ error: 'call_id is required' }, { status: 400 });
  }

  // Fetch the call row — only process if transcript is null
  const rows = await query<{
    id: string;
    contact_id: number | null;
    recording_url: string | null;
    duration_seconds: number | null;
    called_at: string | null;
    transcript: any;
  }>(
    `SELECT id, contact_id, recording_url, duration_seconds, called_at, transcript
     FROM call_recordings WHERE id = $1`,
    [callId],
  );

  if (!rows.length) {
    return NextResponse.json({ error: `Call ${callId} not found` }, { status: 404 });
  }

  const call = rows[0];

  if (call.transcript !== null) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'transcript already exists — use backfill-call-dispositions to re-classify',
    });
  }

  if (!call.recording_url) {
    return NextResponse.json({ error: 'No recording_url for this call' }, { status: 422 });
  }

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

  // Step 1: Fetch audio from S3 and base64-encode it
  let audioBase64: string;
  let mimeType = mimeFromUrl(call.recording_url);
  try {
    const audioRes = await fetch(call.recording_url);
    if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status} fetching audio`);
    const ct = audioRes.headers.get('content-type');
    if (ct) mimeType = ct.split(';')[0].trim() || mimeType;
    audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');
  } catch (err: any) {
    return NextResponse.json({ error: `Audio fetch failed: ${err.message}` }, { status: 502 });
  }

  // Step 2: Gemini multimodal transcription
  let language: string;
  let segments: any[];
  try {
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
    ({ language, segments } = parseTranscriptionResponse(raw));
  } catch (err: any) {
    return NextResponse.json({ error: `Transcription failed: ${err.message}` }, { status: 502 });
  }

  const interruptionCount = segments.filter((s: any) => s.type === 'interruption').length;
  const deadAirCount      = segments.filter((s: any) => s.type === 'dead_air').length;

  // Step 3: Persist transcript
  await insertCallRecording({
    id: callId,
    chatId: null,
    agentId: null,
    contactId: call.contact_id ?? null,
    recordingUrl: call.recording_url,
    durationSeconds: call.duration_seconds ?? null,
    calledAt: call.called_at ?? null,
    language,
    transcript: segments,
  });
  await updateCallRecordingMetrics({ id: callId, interruptionCount, deadAirCount, status: 'pending_link' });

  // Step 4: Classify disposition
  const callTranscriptText = segmentsToText(segments);
  let disposition = '';
  let subDisposition = '';

  if (callTranscriptText) {
    try {
      const rawDisp = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_CLASSIFY_PROMPT + '\n\n## CALL TRANSCRIPT\n' + callTranscriptText }] }],
        { responseMimeType: 'application/json' },
        30_000,
      );
      const classified = parseCallDispositionClassified(rawDisp);
      disposition    = classified.disposition;
      subDisposition = classified.subDisposition;
      if (disposition) {
        await updateCallDisposition(callId, disposition, subDisposition);
      }
    } catch (err: any) {
      console.error(`[retranscribe] Disposition classify failed for call ${callId}:`, err.message);
    }

    // Step 5: Chunk transcript for RAG
    let chunkCount = 0;
    try {
      const rawChunks = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: CALL_CHUNK_PROMPT + '\n\n## CALL TRANSCRIPT\n' + callTranscriptText }] }],
        { responseMimeType: 'application/json' },
        30_000,
      );
      const chunks = parseCallChunks(rawChunks);
      if (chunks.length > 0) {
        await insertCallTranscriptChunks(chunks.map((c, i) => ({
          callId,
          chatId: null,
          contactId: call.contact_id ?? null,
          agentId: null,
          calledAt: call.called_at ?? null,
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

    return NextResponse.json({
      ok: true,
      callId,
      segments: segments.length,
      language,
      disposition,
      subDisposition,
      chunks: chunkCount,
    });
  }

  return NextResponse.json({
    ok: true,
    callId,
    segments: segments.length,
    language,
    disposition: '',
    subDisposition: '',
    chunks: 0,
  });
}
