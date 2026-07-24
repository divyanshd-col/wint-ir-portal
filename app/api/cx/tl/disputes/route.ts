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
  raisedAt:         string;
  status:           'ir_pending_tl' | 'pending' | 'tl_forwarded' | 'tl_resolved' | 'reviewed' | 'cancelled';
  paramCategory:    'cat1' | 'cat2';
  reviewNote:       string | null;
  tlForwarded:      boolean;
  agentNote:        string;
  challengedParams: { param: string; note: string }[];
  parameters:       Record<string, { score: boolean | null; reasoning: string }>;
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
    const configUser = config.users.find(u => (u.email || u.username) === email);
    const tlAgentName = configUser?.agentName ?? email;
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
      if (statusFilter === 'pending') return f.status === 'ir_pending_tl' || f.status === 'pending' || f.status === 'tl_forwarded';
      if (statusFilter === 'resolved') return f.status === 'tl_resolved' || f.status === 'reviewed' || f.status === 'cancelled';
      return false;
    });

  if (!flags.length) return NextResponse.json({ disputes: [] });

  // Bulk-fetch chat data
  const chatIds = [...new Set(flags.map(f => f.chatId))];
  const dbRows = await query<{
    chat_id: string; agent_name: string | null; closed_at: string;
    disposition: string; sub_disposition: string | null;
    iqs_score: string; parameters: any;
    csat_score: string | null; mobile_number: string | null;
  }>(
    `SELECT c.id AS chat_id, a.name AS agent_name, c.closed_at,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            i.iqs_score, i.parameters, c.csat_score,
            ct.phone AS mobile_number
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = ANY($1)`,
    [chatIds]
  );

  const dbMap = new Map(dbRows.map(r => [r.chat_id, r]));

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
    const db = dbMap.get(flag.chatId);
    if (!db) continue;
    // Only show disputes for this TL's agents
    if (!agentNames.includes(db.agent_name ?? '')) continue;

    let params = db.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    let botIqsScore: number | null = null;
    let iqsScore: number | null = null;
    let callIqsScore: number | null = null;

    if (params.__scores) {
      botIqsScore = params.__scores.bot_iqs !== undefined && params.__scores.bot_iqs !== null ? parseFloat(params.__scores.bot_iqs) : null;
      iqsScore = params.__scores.agent_iqs !== undefined && params.__scores.agent_iqs !== null ? parseFloat(params.__scores.agent_iqs) : null;
      callIqsScore = params.__scores.call_iqs !== undefined && params.__scores.call_iqs !== null ? parseFloat(params.__scores.call_iqs) : null;
    }

    if (iqsScore === null) {
      iqsScore = computeIqsFromRawParams(params, false);
    }
    if (botIqsScore === null) {
      botIqsScore = computeIqsFromRawParams(params, true);
    }
    if (botIqsScore === null && db.iqs_score !== null && db.iqs_score !== undefined) {
      botIqsScore = parseFloat(db.iqs_score);
    }

    disputes.push({
      flagId:           flag.id,
      chatId:           flag.chatId,
      agentName:        db.agent_name ?? flag.agentName,
      iqsScore,
      botIqsScore,
      callIqsScore,
      closedAt:         db.closed_at,
      csatScore:        db.csat_score ? parseInt(db.csat_score) : null,
      disposition:      db.disposition,
      subDisposition:   db.sub_disposition,
      raisedBy:         raisedByLabel(flag),
      raisedByName:     flag.agentName,
      raisedAt:         flag.flaggedAt,
      status:           flag.status,
      paramCategory:    flag.paramCategory ?? 'cat1',
      reviewNote:       flag.reviewNote ?? null,
      tlForwarded:      flag.status === 'tl_forwarded',
      agentNote:        flag.agentNote,
      challengedParams: flag.challengedParams ?? [],
      parameters:       params,
    });
  }

  disputes.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));

  log.info(ROUTE, 'result', {
    statusFilter, flagCount: flags.length, filteredCount: disputes.length,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json({ disputes });
});
