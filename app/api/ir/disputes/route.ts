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
  const typeFilter = searchParams.get('type') || '';     // 'calls' | 'chats'

  const raw = await storeGetIQSFlags();
  const all: IQSFlag[] = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);

  let flags = all.filter(f => f.agentEmail === email && f.raisedByRole === 'ir' && f.status !== 'cancelled');

  const isCallFlag = (f: IQSFlag) => Boolean(f.callId);
  if (typeFilter === 'calls') {
    flags = flags.filter(isCallFlag);
  } else if (typeFilter === 'chats') {
    flags = flags.filter(f => !isCallFlag(f));
  }

  if (statusFilter === 'pending') {
    // Still open from the agent's perspective: awaiting TL ('pending'/'ir_pending_tl')
    // or forwarded on to QA ('tl_forwarded') but not yet given a final decision.
    flags = flags.filter(f => f.status === 'pending' || f.status === 'ir_pending_tl' || f.status === 'tl_forwarded');
  } else if (statusFilter === 'resolved') {
    flags = flags.filter(f => f.status === 'tl_resolved' || f.status === 'reviewed');
  }

  // Enrich with iqs_score + closed_at + bot/call IQS + csat from DB (batch queries)
  const chatFlags = flags.filter(f => !f.callId);
  const callFlags = flags.filter(f => Boolean(f.callId));
  const chatIds = [...new Set(chatFlags.map(f => f.chatId).filter(Boolean))];
  const targetCallIds = [...new Set(callFlags.map(f => f.callId).filter(Boolean))] as string[];
  const fallbackChatIds = [...new Set(callFlags.filter(f => !f.callId).map(f => f.chatId).filter(Boolean))];
  const rowMap = new Map<string, any>();
  const callRowMap = new Map<string, any>();

  try {
    const { query } = await import('@/lib/cx/db');
    if (chatIds.length > 0) {
      const rows = await query<any>(
        `SELECT s.chat_id, s.iqs_score, c.closed_at, s.parameters, c.csat_score, c.tags, ct.phone AS mobile_number
         FROM iqs_scores s
         LEFT JOIN conversations c ON c.id = s.chat_id
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         WHERE s.chat_id = ANY($1)`,
        [chatIds]
      );
      for (const r of rows) {
        if (r.chat_id) rowMap.set(String(r.chat_id), r);
      }
    }
    if (targetCallIds.length > 0 || fallbackChatIds.length > 0) {
      const callRows = await query<any>(
        `SELECT ce.call_id, ce.chat_id, ce.iqs_percent, ce.iqs_scores, ce.gates, cr.called_at, cr.call_disposition, cr.call_sub_disposition,
                COALESCE(ct_cr.phone, ct_c.phone) AS mobile_number
         FROM call_evaluations ce
         JOIN call_recordings cr ON cr.id = ce.call_id
         LEFT JOIN conversations c ON c.id = COALESCE(ce.chat_id, cr.chat_id)
         LEFT JOIN contacts ct_cr ON ct_cr.id = cr.contact_id
         LEFT JOIN contacts ct_c ON ct_c.id = c.contact_id
         WHERE ce.call_id = ANY($1) OR ce.chat_id = ANY($1)`,
        [[...targetCallIds, ...fallbackChatIds]]
      );
      for (const r of callRows) {
        if (r.call_id) callRowMap.set(String(r.call_id), r);
        if (r.chat_id && !callRowMap.has(String(r.chat_id))) callRowMap.set(String(r.chat_id), r);
      }
    }
  } catch {
    // DB unavailable — return flag data only
  }

  const { computeIqsFromRawParams } = await import('@/lib/quality');

  const enriched = flags.map((f) => {
    let iqsScore: number | null = null;
    let botIqsScore: number | null = null;
    let callIqsScore: number | null = null;
    let closedAt: string | null = null;
    let parameters: Record<string, any> | null = null;
    let csatScore: number | null = null;
    let disposition = '';
    let subDisposition: string | null = null;

    const isCall = Boolean(f.callId);
    const row = isCall ? null : rowMap.get(String(f.chatId));
    const cRow = isCall ? (f.callId ? callRowMap.get(String(f.callId)) : callRowMap.get(String(f.chatId))) : null;

    if (row) {
      iqsScore = row.iqs_score != null ? parseFloat(row.iqs_score) : null;
      closedAt = row.closed_at ? new Date(row.closed_at).toISOString() : null;
      parameters = row.parameters ?? null;
      csatScore = row.csat_score ?? null;
      const tags = row.tags || {};
      disposition = tags.disposition || '';
      subDisposition = tags.sub_disposition || null;

      if (parameters?.__scores) {
        if (parameters.__scores.bot_iqs != null) botIqsScore = parseFloat(parameters.__scores.bot_iqs);
        if (parameters.__scores.agent_iqs != null) iqsScore = parseFloat(parameters.__scores.agent_iqs);
        if (parameters.__scores.call_iqs != null) callIqsScore = parseFloat(parameters.__scores.call_iqs);
      }
      if (botIqsScore === null && parameters) {
        botIqsScore = computeIqsFromRawParams(parameters, true);
      }
    }

    if (cRow) {
      callIqsScore = cRow.iqs_percent != null ? parseFloat(cRow.iqs_percent) : null;
      iqsScore = callIqsScore;
      if (cRow.called_at) closedAt = new Date(cRow.called_at).toISOString();
      disposition = cRow.call_disposition || '';
      subDisposition = cRow.call_sub_disposition || null;
      parameters = cRow.iqs_scores ?? null;
    }

    return {
      flagId: f.id,
      chatId: f.chatId,
      callId: isCall ? (cRow?.call_id || f.callId) : undefined,
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
      gates: cRow?.gates ?? null,
      mobileNumber: (isCall ? cRow?.mobile_number : row?.mobile_number) || null,
      flaggedAt: f.flaggedAt,
    };
  });

  // Sort newest first
  enriched.sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime());

  return NextResponse.json({ disputes: enriched });
}
