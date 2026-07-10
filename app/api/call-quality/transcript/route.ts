import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getCallRecording } from '@/lib/robylon/db';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const callId = new URL(req.url).searchParams.get('callId');
  if (!callId) return NextResponse.json({ error: 'callId required' }, { status: 400 });

  const row = await getCallRecording(callId);
  if (!row) return NextResponse.json({ ok: true, found: false });

  return NextResponse.json({
    ok: true,
    found: true,
    callId: row.id,
    chatId: row.chat_id,
    language: row.language,
    interruptionCount: row.interruption_count,
    deadAirCount: row.dead_air_count,
    durationSeconds: row.duration_seconds,
    calledAt: row.called_at,
    recordingUrl: row.recording_url,
    segments: Array.isArray(row.transcript) ? row.transcript : [],
  });
}
