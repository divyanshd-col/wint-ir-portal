import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getCallRecording } from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const callId = new URL(req.url).searchParams.get('callId');
  if (!callId) return NextResponse.json({ error: 'callId required' }, { status: 400 });

  const row = await getCallRecording(callId);
  if (!row) {
    try {
      const pcgRows = await query<any>(
        `SELECT r.*, e.transcript_turns, e.iqs_score, e.parameters, e.gates
         FROM pcg_call_recordings r
         LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
         WHERE r.call_id = $1 
            OR r.call_id = 'call-' || $1 
            OR r.call_id = 'runo-' || $1 
            OR r.call_id LIKE '%' || $1 || '%'
            OR e.call_id = $1
            OR r.id::text = $1
         LIMIT 1`,
        [callId]
      );
      if (pcgRows.length > 0) {
        const pcgRow = pcgRows[0];
        let rawTurns = pcgRow.transcript_turns || pcgRow.raw_payload?.transcript || [];
        if (typeof rawTurns === 'string') {
          try { rawTurns = JSON.parse(rawTurns); } catch { rawTurns = []; }
        }
        let segments: any[] = [];
        if (Array.isArray(rawTurns)) {
          segments = rawTurns.map((turn: any, idx: number) => ({
            speaker: turn.speaker === 'RM' ? 'IR_EXECUTIVE' : 'INVESTOR',
            text: turn.text,
            ts: turn.time || `0:${(idx * 3 + 3).toString().padStart(2, '0')}`,
          }));
        }
        return NextResponse.json({
          ok: true,
          found: true,
          callId: pcgRow.call_id || pcgRow.id,
          recordingUrl: `/api/admin/pcg-calls/audio?id=${encodeURIComponent(pcgRow.id)}`,
          segments,
          iqsPercent: pcgRow.iqs_score,
          gates: pcgRow.gates,
        });
      }
    } catch (err) {
      console.error('[transcript] PCG lookup failed:', err);
    }
    return NextResponse.json({ ok: true, found: false });
  }

  let evalData: any = null;
  try {
    const evalRows = await query<any>(
      `SELECT chat_id, gates, iqs_scores, iqs_percent, verdict, status, reviewed_by, review_note 
       FROM call_evaluations 
       WHERE call_id = $1 OR chat_id = $1 
       ORDER BY scored_at DESC NULLS LAST LIMIT 1`,
      [callId]
    );
    if (evalRows.length > 0) {
      evalData = evalRows[0];
    }
  } catch (err) {
    console.error('[transcript] failed to fetch call_evaluations:', err);
  }

  let chatStatus: string | null = null;
  const effectiveChatId = row.chat_id || (evalData?.chat_id);
  if (effectiveChatId) {
    try {
      const chatRows = await query<any>(`SELECT status FROM iqs_scores WHERE chat_id = $1 LIMIT 1`, [effectiveChatId]);
      if (chatRows.length > 0) {
        chatStatus = chatRows[0].status;
      }
    } catch (err) {
      console.error('[transcript] failed to fetch iqs_scores status:', err);
    }
  }

  const transcriptData = typeof row.transcript === 'string'
    ? (() => { try { return JSON.parse(row.transcript); } catch { return row.transcript; } })()
    : row.transcript;

  const isObj = transcriptData && typeof transcriptData === 'object' && !Array.isArray(transcriptData);
  const segments = Array.isArray(transcriptData)
    ? transcriptData
    : (isObj && Array.isArray(transcriptData.segments) ? transcriptData.segments : []);
  const reevalCount = isObj ? Number(transcriptData.reevalCount || (transcriptData.editedAt ? 1 : 0)) : 0;

  return NextResponse.json({
    ok: true,
    found: true,
    callId: row.id,
    chatId: row.chat_id,
    chatStatus: chatStatus || (evalData?.status ?? null),
    language: row.language,
    interruptionCount: row.interruption_count,
    deadAirCount: row.dead_air_count,
    durationSeconds: row.duration_seconds,
    calledAt: row.called_at,
    recordingUrl: row.recording_url,
    segments,
    reevalCount,
    hasReevaluated: reevalCount > 0,
    gates: evalData?.gates ?? null,
    iqsScores: evalData?.iqs_scores ?? null,
    iqsPercent: evalData?.iqs_percent ?? null,
    verdict: evalData?.verdict ?? null,
    reviewedBy: evalData?.reviewed_by ?? null,
    reviewNote: evalData?.review_note ?? null,
    mobileNumber: row.mobile_number ?? null,
  });
}
