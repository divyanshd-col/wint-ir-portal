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
  const { session, response } = await requireRole(['admin', 'quality']);
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
    return NextResponse.json({ error: `Call ${callId} not found` }, { status: 404 });
  }

  const existing = rows[0];
  const existingTranscript = typeof existing.transcript === 'string'
    ? (() => { try { return JSON.parse(existing.transcript); } catch { return existing.transcript; } })()
    : existing.transcript;

  const isObj = existingTranscript && typeof existingTranscript === 'object' && !Array.isArray(existingTranscript);
  const prevCount = isObj ? Number(existingTranscript.reevalCount || (existingTranscript.editedAt ? 1 : 0)) : 0;

  const role = (session.user as any)?.role;
  if (role === 'quality' && prevCount >= 1) {
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
