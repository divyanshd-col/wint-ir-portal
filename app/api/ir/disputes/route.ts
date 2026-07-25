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
    flags = flags.filter(f => f.status === 'ir_pending_tl' || f.status === 'tl_forwarded');
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
      const rows = await query<any>(
        `SELECT s.iqs_score, c.closed_at, s.parameters, c.csat_score, c.tags
         FROM iqs_scores s
         LEFT JOIN conversations c ON c.id = s.conversation_id
         WHERE s.conversation_id = $1
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
    } catch {
      // DB unavailable — return flag data only
    }

    return {
      flagId: f.id,
      chatId: f.chatId,
      iqsScore,
      botIqsScore,
      callIqsScore,
      csatScore,
      disposition,
      subDisposition,
      closedAt: closedAt || f.flaggedAt,
      status: f.status,
      paramCategory: f.paramCategory,
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
