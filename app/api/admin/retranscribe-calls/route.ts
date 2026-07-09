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

export const runtime    = 'nodejs';
export const maxDuration = 300;
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_DISPOSITION_CLASSIFY_PROMPT,
  parseTranscriptionResponse,
  parseCallDispositionClassified,
  segmentsToText,
} from '@/lib/call-quality';
import {
  updateCallDisposition,
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

async function getPendingCalls(callIds?: string[]): Promise<CallRecordingRow[]> {
  if (callIds?.length) {
    return query<CallRecordingRow>(
      `SELECT * FROM call_recordings WHERE id = ANY($1) AND recording_url IS NOT NULL`,
      [callIds],
    );
  }
  return query<CallRecordingRow>(
    `SELECT * FROM call_recordings
     WHERE transcript IS NULL
       AND recording_url IS NOT NULL
       AND called_at >= CURRENT_DATE
     ORDER BY called_at ASC
     LIMIT 10`,
    [],
  );
}

async function transcribeCall(
  call: CallRecordingRow,
  geminiKeys: string[],
): Promise<{ disposition: string; subDisposition: string; segments: number }> {
  const { id: callId, recording_url: recordingUrl } = call;

  if (!recordingUrl) throw new Error('No recording_url');
  
  // Step 1: Fetch audio
  let audioBase64 = '';
  let mimeType = mimeFromUrl(recordingUrl);
  const audioRes = await fetch(recordingUrl);
  if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status} fetching audio from ${recordingUrl}`);
  const ct = audioRes.headers.get('content-type');
  if (ct && ct.startsWith('audio/')) mimeType = ct.split(';')[0].trim();
  audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');


  // Step 2: Gemini audio transcription — 5 retries × 5-model chain via callGeminiForCall
  const raw = await callGeminiForCall(
    geminiKeys,
    [{ parts: [
      { inline_data: { mime_type: mimeType, data: audioBase64 } },
      { text: CALL_TRANSCRIPTION_PROMPT },
    ]}],
    undefined,
    270_000,
  );

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

  if (transcriptText.trim()) {
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
  }

  return { disposition, subDisposition, segments: segments.length };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  let body: { call_id?: string; call_ids?: string[] } = {};
  try { body = await req.json(); } catch {}

  // Support single call_id or batch call_ids array
  const callIds: string[] | undefined =
    body.call_ids?.length ? body.call_ids.map(s => s.trim()).filter(Boolean)
    : body.call_id?.trim() ? [body.call_id.trim()]
    : undefined;

  let geminiKeys: string[];
  try {
    const config = await readConfig();
    geminiKeys = getIQSGeminiKeys(config);
  } catch (err: any) {
    return NextResponse.json({ error: `Config error: ${err.message}` }, { status: 500 });
  }
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 503 });
  }

  const calls = await getPendingCalls(callIds);
  if (!calls.length) {
    const reason = callIds?.length
      ? `No calls found for IDs: ${callIds.join(', ')}`
      : 'No calls today with null transcript and a recording_url';
    return NextResponse.json({ ok: true, message: reason, processed: 0 });
  }

  // Process all calls in parallel — total time = slowest single call, not sum of all
  const settled = await Promise.allSettled(
    calls.map(async call => {
      const r = await transcribeCall(call, geminiKeys);
      console.log(`[retranscribe] call ${call.id} — ${r.segments} segments, disposition=${r.disposition}`);
      return { callId: call.id, ...r };
    })
  );

  const results = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { callId: calls[i].id, error: (s.reason as any)?.message ?? String(s.reason) }
  );

  return NextResponse.json({
    ok: true,
    processed: calls.length,
    succeeded: results.filter(r => !('error' in r)).length,
    failed: results.filter(r => 'error' in r).length,
    results,
  });
}

// GET: preview how many calls today have null transcript
export async function GET(): Promise<NextResponse> {
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
