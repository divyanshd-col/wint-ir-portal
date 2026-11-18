/**
 * PATCH /api/call-quality/update-transcript
 *
 * Saves a manually corrected call transcript back to call_recordings.
 * Used by agents/quality members to fix speaker labels or transcription errors.
 *
 * Body: { call_id: string, segments: CallSegment[] }
 * Auth: any authenticated user (agents correct their own transcripts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  let body: { call_id?: string; segments?: any[] } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const callId = body.call_id?.trim();
  if (!callId) return NextResponse.json({ error: 'call_id is required' }, { status: 400 });
  if (!Array.isArray(body.segments)) {
    return NextResponse.json({ error: 'segments array is required' }, { status: 400 });
  }

  // Fetch existing row to preserve language and other metadata
  const rows = await query<{ transcript: any; language: string | null }>(
    `SELECT transcript, language FROM call_recordings WHERE id = $1`,
    [callId],
  );
  if (!rows.length) {
    // Fallback: PCG calls live in pcg_call_recordings / pcg_call_evaluations
    const pcgRows = await query<{ call_id: string }>(
      `SELECT call_id FROM pcg_call_recordings
       WHERE call_id = $1 OR call_id LIKE '%' || $1 OR id::text = $1
       LIMIT 1`,
      [callId],
    );
    if (!pcgRows.length) {
      return NextResponse.json({ error: `Call ${callId} not found` }, { status: 404 });
    }
    const targetCallId = pcgRows[0].call_id;
    const pcgTurns = body.segments
      .filter((s: any) => s && s.type !== 'dead_air' && s.type !== 'interruption' && typeof s.text === 'string' && s.text.trim())
      .map((s: any, idx: number) => {
        const spk = String(s.speaker || '').toUpperCase();
        const isRm = spk === 'IR_EXECUTIVE' || spk === 'IR EXECUTIVE' || spk === 'RM' || spk.includes('AGENT');
        return {
          speaker: isRm ? 'RM' : 'Customer',
          text: s.text.trim(),
          time: s.ts || s.time || '00:00',
          turnIndex: idx + 1,
        };
      });

    await query(
      `UPDATE pcg_call_evaluations
       SET transcript_turns = $1::jsonb, updated_at = NOW()
       WHERE call_id = $2`,
      [JSON.stringify(pcgTurns), targetCallId],
    );

    return NextResponse.json({ ok: true, callId: targetCallId, isPcg: true, segmentCount: pcgTurns.length });
  }

  const existing = rows[0];
  const existingTranscript = typeof existing.transcript === 'string'
    ? (() => { try { return JSON.parse(existing.transcript); } catch { return existing.transcript; } })()
    : existing.transcript;

  const isObj = existingTranscript && typeof existingTranscript === 'object' && !Array.isArray(existingTranscript);
  const prevCount = isObj ? Number(existingTranscript.reevalCount || (existingTranscript.editedAt ? 1 : 0)) : 0;

  const role = (session.user as any)?.role;
  if ((role === 'quality' || role === 'tl') && prevCount >= 1) {
    return NextResponse.json({ error: 'Re-evaluation has already been performed once for this call.' }, { status: 403 });
  }

  // Merge new segments into existing transcript structure, preserving language
  const updatedTranscript = {
    ...(isObj ? existingTranscript : {}),
    segments: body.segments,
    editedAt: new Date().toISOString(),
    editedBy: (session.user as any)?.email || 'unknown',
    reevalCount: prevCount + 1,
  };

  await query(
    `UPDATE call_recordings SET transcript = $1, status = 'transcribed', updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(updatedTranscript), callId],
  );

  return NextResponse.json({ ok: true, callId, segmentCount: body.segments.length, reevalCount: prevCount + 1 });
}
