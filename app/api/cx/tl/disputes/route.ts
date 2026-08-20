import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { getAgentNamesByTL } from '@/lib/robylon/db';
import { storeGetIQSFlags } from '@/lib/store';
import type { IQSFlag } from '@/lib/store';
import { log, withLogging } from '@/lib/log';
import { computeIqsFromRawParams } from '@/lib/quality';

const ROUTE = 'cx/tl/disputes';

export interface TLDisputeRow {
  flagId:           string;
  chatId:           string;
  callId?:          string;
  agentName:        string;
  iqsScore:         number | null;
  botIqsScore?:     number | null;
  callIqsScore?:    number | null;
  closedAt:         string;
  csatScore:        number | null;
  disposition:      string;
  subDisposition:   string | null;
  raisedBy:         string;
  raisedByName:     string;
  raisedByRole:     'ir' | 'tl';
  raisedAt:         string;
  status:           'ir_pending_tl' | 'pending' | 'tl_forwarded' | 'tl_resolved' | 'reviewed' | 'cancelled';
  reviewNote:       string | null;
  tlForwarded:      boolean;
  agentNote:        string;
  challengedParams: { param: string; note: string }[];
  parameters:       Record<string, { score: boolean | null; reasoning: string }>;
  gates?:           any;
  conversationType?: 'bot' | 'agent' | 'hybrid';
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  if (!['tl', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') ?? 'pending';

  // Resolve TL's agents
  let agentNames: string[];
  if (role === 'admin') {
    const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active'`);
    agentNames = rows.map(r => r.name);
  } else {
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    let tlAgentName = configUser?.agentName;
    if (!tlAgentName && email) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(email).catch(() => null);
      if (dbUser?.name) tlAgentName = dbUser.name;
    }
    if (!tlAgentName) tlAgentName = email;
    agentNames = await getAgentNamesByTL(tlAgentName);
  }

  if (!agentNames.length) {
    return NextResponse.json({ disputes: [] });
  }

  const t0 = Date.now();
  const rawFlags = await storeGetIQSFlags();

  // Filter by requested status
  const flags: IQSFlag[] = rawFlags
    .map(r => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .filter((f): f is IQSFlag => {
      if (!f) return false;
      // 'pending' = awaiting TL action (the actionable "Disputes Raised" queue).
      // 'resolved' = already forwarded to QA or given a final decision (history).
      if (statusFilter === 'pending') return f.status === 'ir_pending_tl' || f.status === 'pending';
      if (statusFilter === 'resolved') return f.status === 'tl_forwarded' || f.status === 'tl_resolved' || f.status === 'reviewed' || f.status === 'cancelled';
      return false;
    });

  if (!flags.length) return NextResponse.json({ disputes: [] });

  // Separate chat vs call flags
  const chatFlags = flags.filter(f => !f.callId);
  const callFlags = flags.filter(f => Boolean(f.callId));

  const chatIds = [...new Set(chatFlags.map(f => f.chatId).filter(Boolean))];
  const targetCallIds = [...new Set(callFlags.map(f => f.callId!).filter(Boolean))];

  let dbRows: {
    chat_id: string; agent_id: number | null; agent_name: string | null; closed_at: string;
    disposition: string; sub_disposition: string | null;
    iqs_score: string; parameters: any;
    csat_score: string | null; mobile_number: string | null;
    conversation_type: string | null;
  }[] = [];
  if (chatIds.length > 0) {
    dbRows = await query(
      `SELECT c.id AS chat_id, c.agent_id, a.name AS agent_name, c.closed_at,
              c.tags->>'disposition'     AS disposition,
              c.tags->>'sub_disposition' AS sub_disposition,
              i.iqs_score, i.parameters, c.csat_score,
              ct.phone AS mobile_number, c.conversation_type
       FROM conversations c
       JOIN iqs_scores i ON i.chat_id = c.id
       LEFT JOIN agents a ON a.id = c.agent_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = ANY($1)`,
      [chatIds]
    );
  }
  const dbMap = new Map(dbRows.map(r => [r.chat_id, r]));

  // Bulk-fetch call data strictly by call_id for call disputes
  let callDbRows: {
    call_id: string; chat_id: string | null; agent_name: string | null;
    called_at: string; disposition: string; sub_disposition: string | null;
    iqs_percent: string | null; parameters: any; gates: any;
  }[] = [];
  if (targetCallIds.length > 0) {
    callDbRows = await query(
      `SELECT ce.call_id, ce.chat_id, COALESCE(a.name, '') AS agent_name,
              cr.called_at, cr.call_disposition AS disposition,
              cr.call_sub_disposition AS sub_disposition,
              ce.iqs_percent, ce.iqs_scores AS parameters,
              ce.gates
       FROM call_evaluations ce
       JOIN call_recordings cr ON cr.id = ce.call_id
       LEFT JOIN agents a ON a.id = ce.agent_id
       WHERE ce.call_id = ANY($1)`,
      [targetCallIds]
    );
  }
  const callDbMap = new Map(callDbRows.map(r => [r.call_id, r]));

  // Build role label for who raised the dispute
  const config = await readConfig();
  const roleMap: Record<string, string> = {};
  for (const u of config.users ?? []) {
    const key = (u.email || u.username || '').toLowerCase();
    if (key) roleMap[key] = u.role ?? 'agent';
  }
  function raisedByLabel(flag: IQSFlag): string {
    if (flag.raisedByRole === 'tl') return 'TL';
    if (flag.raisedByRole === 'ir' || flag.raisedByRole === 'agent') return 'IR';
    const r = roleMap[(flag.agentEmail || '').toLowerCase()] ?? 'agent';
    return r === 'tl' ? 'TL' : 'IR';
  }

  const disputes: TLDisputeRow[] = [];
  for (const flag of flags) {
    const isCall = Boolean(flag.callId);
    const db = isCall ? null : dbMap.get(flag.chatId);
    const callDb = isCall ? callDbMap.get(flag.callId!) : null;

    if (!db && !callDb) continue;

    // Only show disputes for this TL's agents (supporting prefix/full match)
    const matchesAgent = (name: string | null) => {
      if (!name) return false;
      return agentNames.some(a =>
        a.toLowerCase() === name.toLowerCase() ||
        a.toLowerCase().startsWith(name.toLowerCase() + ' ') ||
        name.toLowerCase().startsWith(a.toLowerCase() + ' ')
      );
    };

    const agentName = db?.agent_name || callDb?.agent_name || flag.agentName;
    if (!matchesAgent(db?.agent_name ?? null) && !matchesAgent(callDb?.agent_name ?? null) && !matchesAgent(flag.agentName)) continue;

    let params = isCall ? (callDb?.parameters ?? {}) : (db?.parameters ?? {});
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    let botIqsScore: number | null = null;
    let iqsScore: number | null = null;
    let callIqsScore: number | null = null;

    if (params.__scores) {
      botIqsScore = params.__scores.bot_iqs !== undefined && params.__scores.bot_iqs !== null ? parseFloat(params.__scores.bot_iqs) : null;
      iqsScore = params.__scores.agent_iqs !== undefined && params.__scores.agent_iqs !== null ? parseFloat(params.__scores.agent_iqs) : null;
      callIqsScore = params.__scores.call_iqs !== undefined && params.__scores.call_iqs !== null ? parseFloat(params.__scores.call_iqs) : null;
    }

    if (callDb?.iqs_percent != null && isCall) {
      callIqsScore = parseFloat(callDb.iqs_percent);
      if (iqsScore === null) iqsScore = callIqsScore;
    }

    const isBot = db ? (
      db.agent_name === 'Robylon AI'
      || db.conversation_type === 'bot'
      || (db.agent_id !== null && [15, 447, 784].includes(Number(db.agent_id)))
    ) : false;

    if (iqsScore === null && !isBot && !callDb) {
      iqsScore = computeIqsFromRawParams(params, false);
    }
    if (botIqsScore === null && !callDb) {
      botIqsScore = computeIqsFromRawParams(params, true);
    }
    if (botIqsScore === null && db?.iqs_score !== null && db?.iqs_score !== undefined) {
      botIqsScore = parseFloat(db.iqs_score);
    }
    if (isBot) {
      iqsScore = null;
    }

    const roleTag = raisedByLabel(flag);
    const submitterUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === (flag.agentEmail || '').toLowerCase());
    const effectiveRaisedByName = (flag.raisedByRole === 'tl' || roleTag === 'TL')
      ? (submitterUser?.agentName || submitterUser?.username || flag.agentEmail?.split('@')[0] || 'TL')
      : (flag.agentName || agentName);

    disputes.push({
      flagId:           flag.id,
      chatId:           flag.chatId,
      callId:           isCall ? flag.callId : undefined,
      agentName:        agentName,
      iqsScore,
      botIqsScore,
      callIqsScore,
      closedAt:         db?.closed_at ? new Date(db.closed_at).toISOString() : (callDb?.called_at ? new Date(callDb.called_at).toISOString() : flag.flaggedAt || ''),
      csatScore:        db?.csat_score ? parseInt(db.csat_score) : null,
      disposition:      db?.disposition || callDb?.disposition || '',
      subDisposition:   db?.sub_disposition || callDb?.sub_disposition || null,
      raisedBy:         roleTag,
      raisedByName:     effectiveRaisedByName,
      raisedByRole:     flag.raisedByRole || (roleTag === 'TL' ? 'tl' : 'ir'),
      raisedAt:         flag.flaggedAt,
      status:           flag.status,
      reviewNote:       flag.reviewNote ?? null,
      tlForwarded:      flag.status === 'tl_forwarded',
      agentNote:        flag.agentNote,
      challengedParams: flag.challengedParams ?? [],
      parameters:       params,
      gates:            callDb?.gates ?? null,
      conversationType: (db?.conversation_type ?? null) as any,
    });
  }

  const typeParam = new URL(req.url).searchParams.get('type');
  let finalDisputes = disputes;
  if (typeParam === 'calls') {
    finalDisputes = disputes.filter(d => Boolean(d.callId));
  } else if (typeParam === 'chats') {
    finalDisputes = disputes.filter(d => !d.callId);
  }

  finalDisputes.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));

  log.info(ROUTE, 'result', {
    statusFilter, flagCount: flags.length, filteredCount: finalDisputes.length,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json({ disputes: finalDisputes });
});
