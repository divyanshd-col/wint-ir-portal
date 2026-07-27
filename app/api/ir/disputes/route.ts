import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetIQSFlags } from '@/lib/store';
import type { IQSFlag } from '@/lib/store';

function agentAccess(session: any) {
  return ['admin', 'agent'].includes(session?.user?.role || '');
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !agentAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const email = (session.user as any)?.email || '';
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') || ''; // 'pending' | 'resolved'

  const raw = await storeGetIQSFlags();
  const all: IQSFlag[] = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);

  let flags = all.filter(f => f.agentEmail === email && f.raisedByRole === 'ir' && f.status !== 'cancelled');

  if (statusFilter === 'pending') {
    // Still open from the agent's perspective: awaiting TL ('pending'/'ir_pending_tl')
    // or forwarded on to QA ('tl_forwarded') but not yet given a final decision.
    flags = flags.filter(f => f.status === 'pending' || f.status === 'ir_pending_tl' || f.status === 'tl_forwarded');
  } else if (statusFilter === 'resolved') {
    flags = flags.filter(f => f.status === 'tl_resolved' || f.status === 'reviewed');
  }

  // Enrich with iqs_score + closed_at + bot/call IQS + csat from DB
  const enriched = await Promise.all(flags.map(async (f) => {
    let iqsScore: number | null = null;
    let botIqsScore: number | null = null;
    let callIqsScore: number | null = null;
    let closedAt: string | null = null;
    let parameters: Record<string, any> | null = null;
    let csatScore: number | null = null;
    let disposition = '';
    let subDisposition: string | null = null;

    try {
      const { query } = await import('@/lib/cx/db');
      // iqs_scores' primary key is chat_id, NOT conversation_id. The old column
      // name threw on every row, the bare catch swallowed it, and the agent saw
      // "—" for IQS and a null parameters panel on every dispute.
      const rows = await query<any>(
        `SELECT s.iqs_score, c.closed_at, s.parameters, c.csat_score, c.tags
         FROM iqs_scores s
         LEFT JOIN conversations c ON c.id = s.chat_id
         WHERE s.chat_id = $1
         LIMIT 1`,
        [f.chatId],
      );
      if (rows.length > 0) {
        iqsScore = rows[0].iqs_score != null ? parseFloat(rows[0].iqs_score) : null;
        closedAt = rows[0].closed_at ? new Date(rows[0].closed_at).toISOString() : null;
        parameters = rows[0].parameters ?? null;
        csatScore = rows[0].csat_score ?? null;
        const tags = rows[0].tags || {};
        disposition = tags.disposition || '';
        subDisposition = tags.sub_disposition || null;

        if (parameters?.__scores) {
          if (parameters.__scores.bot_iqs != null) botIqsScore = parseFloat(parameters.__scores.bot_iqs);
          if (parameters.__scores.agent_iqs != null) iqsScore = parseFloat(parameters.__scores.agent_iqs);
          if (parameters.__scores.call_iqs != null) callIqsScore = parseFloat(parameters.__scores.call_iqs);
        }
        if (botIqsScore === null && parameters) {
          const { computeIqsFromRawParams } = await import('@/lib/quality');
          botIqsScore = computeIqsFromRawParams(parameters, true);
        }
      }

      // If no chat score found or flag is explicitly for a call, try call_evaluations & call_recordings
      const targetCallId = f.callId || f.chatId;
      if (targetCallId) {
        const callRows = await query<any>(
          `SELECT ce.iqs_percent, ce.iqs_scores, cr.called_at, cr.call_disposition, cr.call_sub_disposition
           FROM call_evaluations ce
           JOIN call_recordings cr ON cr.id = ce.call_id
           WHERE ce.call_id = $1 OR ce.chat_id = $1
           LIMIT 1`,
          [targetCallId]
        );
        if (callRows.length > 0) {
          const cRow = callRows[0];
          callIqsScore = cRow.iqs_percent != null ? parseFloat(cRow.iqs_percent) : null;
          if (iqsScore === null) iqsScore = callIqsScore;
          if (!closedAt && cRow.called_at) closedAt = new Date(cRow.called_at).toISOString();
          if (!disposition) disposition = cRow.call_disposition || '';
          if (!subDisposition) subDisposition = cRow.call_sub_disposition || null;
          if (!parameters) parameters = cRow.iqs_scores ?? null;
        }
      }
    } catch {
      // DB unavailable — return flag data only
    }

    return {
      flagId: f.id,
      chatId: f.chatId,
      callId: f.callId || f.chatId,
      iqsScore,
      botIqsScore,
      callIqsScore,
      csatScore,
      disposition,
      subDisposition,
      closedAt: closedAt || f.flaggedAt,
      status: f.status,
      challengedParams: f.challengedParams || [],
      agentNote: f.agentNote || '',
      reviewNote: f.reviewNote || '',
      reviewedBy: f.reviewedBy || '',
      reviewedAt: f.reviewedAt || '',
      parameters,
      flaggedAt: f.flaggedAt,
    };
  }));

  // Sort newest first
  enriched.sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime());

  return NextResponse.json({ disputes: enriched });
}
