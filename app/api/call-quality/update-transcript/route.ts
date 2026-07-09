const ROUTE = 'call-quality/update-transcript';
import { log, withLogging } from '@/lib/log';
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
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

async function _PATCH(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

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
    ? JSON.parse(existing.transcript)
    : existing.transcript;

  // Merge new segments into existing transcript structure, preserving language
  const updatedTranscript = {
    ...(existingTranscript && typeof existingTranscript === 'object' ? existingTranscript : {}),
    segments: body.segments,
    editedAt: new Date().toISOString(),
    editedBy: (session.user as any)?.email || 'unknown',
  };

  await query(
    `UPDATE call_recordings SET transcript = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(updatedTranscript), callId],
  );

  return NextResponse.json({ ok: true, callId, segmentCount: body.segments.length });
}

export const PATCH = withLogging(ROUTE, _PATCH);
