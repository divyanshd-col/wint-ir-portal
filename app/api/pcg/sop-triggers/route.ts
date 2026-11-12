import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import {
  getPcgSopTriggersForCall,
  detectPcgSopTriggers,
  savePcgSopTriggers,
  sendPcgSopSlackAlert,
  updatePcgSopSlackStatus,
  updatePcgSopReview,
  getPcgSopSlackChannel,
  PCG_MONITORING_CATEGORIES,
} from '@/lib/pcg/sop-alert';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys } from '@/lib/gemini';
import { resolvePcgAgent, resolvePcgAgentAsync } from '@/lib/scoring/pcg-pipeline';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const callId = searchParams.get('call_id') || searchParams.get('callId');

  if (!callId) {
    // Return the list of canonical 7 monitoring categories if no callId specified
    return NextResponse.json({
      success: true,
      categories: PCG_MONITORING_CATEGORIES,
    });
  }

  try {
    const triggers = await getPcgSopTriggersForCall(callId);
    return NextResponse.json({
      success: true,
      callId,
      count: triggers.length,
      triggers,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch SOP triggers' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/pcg/sop-triggers
 * Triggers SOP check for a specific call, saves detected triggers, and dispatches Slack alerts.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const callId = body.callId || body.call_id;
    if (!callId) {
      return NextResponse.json({ error: 'callId is required' }, { status: 400 });
    }

    const rows = await query<any>(
      `SELECT r.*, e.transcript_turns, e.sop_triggers
       FROM pcg_call_recordings r
       LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
       WHERE r.call_id = $1 OR r.id::text = $1 LIMIT 1`,
      [callId]
    );

    if (!rows.length) {
      return NextResponse.json({ error: `Call ${callId} not found` }, { status: 404 });
    }

    const call = rows[0];
    const caller = (call.called_by && call.called_by.trim() && call.called_by.toLowerCase() !== 'unknown')
      ? call.called_by.trim()
      : (call.agent_name && call.agent_name.trim() ? call.agent_name.trim() : 'Unassigned RM');
    const { rm: resolvedRm, tl: resolvedTl } = await resolvePcgAgentAsync(caller);

    let rawTurns = call.transcript_turns;
    if (typeof rawTurns === 'string') {
      try { rawTurns = JSON.parse(rawTurns); } catch { rawTurns = []; }
    }
    const transcriptTurns: Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; turnIndex: number }> =
      Array.isArray(rawTurns) ? rawTurns : [];

    const config = await readConfig().catch(() => ({} as any));
    const geminiKeys = getIQSGeminiKeys(config);

    const detected = await detectPcgSopTriggers(
      transcriptTurns,
      {
        callId: call.call_id,
        rmName: resolvedRm,
        tlName: resolvedTl,
        customerPhone: call.phone_number,
        durationSeconds: call.duration_seconds,
      },
      geminiKeys
    );

    let saved = await savePcgSopTriggers(call.call_id, detected);

    // If dryRun is not requested, fire Slack alerts
    const dryRun = body.dryRun === true;
    const alertResults: any[] = [];
    if (!dryRun && saved.length > 0) {
      const sopSlackChannel = getPcgSopSlackChannel();
      for (const trig of saved) {
        const slackRes = await sendPcgSopSlackAlert(
          trig,
          {
            callId: call.call_id,
            rmName: resolvedRm,
            tlName: resolvedTl,
            customerPhone: call.phone_number,
            durationSeconds: call.duration_seconds,
          }
        );
        if (trig.id) {
          await updatePcgSopSlackStatus(
            trig.id,
            slackRes.ok,
            sopSlackChannel,
            slackRes.ts,
            slackRes.error
          );
        }
        alertResults.push({ triggerId: trig.id, category: trig.category, ...slackRes });
      }
    }

    return NextResponse.json({
      success: true,
      callId: call.call_id,
      detectedCount: detected.length,
      triggers: saved,
      alerts: alertResults,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to process SOP detection' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/pcg/sop-triggers
 * Update review status for a specific trigger (e.g. ACKNOWLEDGED or FALSE_POSITIVE).
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { triggerId, status, reviewNote } = body;

    if (!triggerId || !status) {
      return NextResponse.json({ error: 'triggerId and status are required' }, { status: 400 });
    }

    const reviewedBy = session.user?.name || session.user?.email || 'TL';
    const ok = await updatePcgSopReview(triggerId, status, reviewedBy, reviewNote);

    return NextResponse.json({ success: ok });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to update review status' },
      { status: 500 }
    );
  }
}

