import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';
import { query } from '@/lib/cx/db';
import { getAgentNamesByTL } from '@/lib/robylon/db';
import { log, withLogging } from '@/lib/log';
import { readConfig } from '@/lib/config';
import { computeIqsFromRawParams } from '@/lib/quality';

const ROUTE = 'cx/tl/chats';

export interface TLChatRow {
  chatId:        string;
  agentName:     string;
  iqsScore:      number | null;
  botIqsScore?:  number | null;
  callIqsScore?: number | null;
  callTranscriptStatus?: 'transcribed' | 'pending' | 'no_call';
  callTranscriptLabel?: string;
  closedAt:      string;
  disposition:   string;
  subDisposition: string | null;
  csatScore:     number | null;
  mobileNumber:  string | null;
  parameters:    Record<string, { score: boolean | null; reasoning: string }>;
  failedParams:  string[];
  reviewedBy:    string | null;
  reviewedAt:    string | null;
  conversationType?: 'bot' | 'agent' | 'hybrid';
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const { session, response } = await requireRole(['tl', 'admin', 'quality']);
  if (response) return response;
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  const { searchParams } = new URL(req.url);

  // Resolve TL / QA / Admin agents
  let agentNames: string[];
  if (role === 'admin' || role === 'quality') {
    const explicit = searchParams.get('agent');
    if (explicit) {
      const rows = await query<{ name: string }>(
        `SELECT name FROM agents WHERE name = $1 OR name ILIKE $1 || ' %' OR $1 ILIKE name || ' %'`,
        [explicit]
      );
      agentNames = rows.length ? rows.map(r => r.name) : [explicit];
    } else {
      const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active'`);
      agentNames = rows.map(r => r.name);
    }
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
    const agentFilter = searchParams.get('agent');
    if (agentFilter) {
      agentNames = agentNames.filter(n =>
        n.toLowerCase() === agentFilter.toLowerCase() ||
        n.toLowerCase().startsWith(agentFilter.toLowerCase() + ' ') ||
        agentFilter.toLowerCase().startsWith(n.toLowerCase() + ' ')
      );
    }
  }

  if (!agentNames.length) {
    return NextResponse.json({ chats: [], total: 0, agents: [] });
  }

  const sqlParams: unknown[] = [agentNames];
  let paramIdx = 2;
  let extraWhere = '';

  const config = await readConfig();
  const map = config.qaDispositionMap ?? [];
  const qaEntry = map.find(e => e.email.toLowerCase() === email.toLowerCase());

  // For QA (or mapped admins), restrict by assigned dispositions (except Manorathi)
  if ((role === 'quality' || qaEntry) && email.toLowerCase() !== 'manorathi@wintwealth.com' && email.toLowerCase() !== 'manorathi.t@wintwealth.com') {
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    const strictDispositions = qaEntry?.dispositions ?? configUser?.assignedDispositions ?? [];
    if (strictDispositions.length > 0) {
      extraWhere += ` AND c.tags->>'disposition' = ANY($${paramIdx++})`;
      sqlParams.push(strictDispositions);
    } else {
      // If no dispositions assigned, show nothing
      extraWhere += ` AND 1 = 0`;
    }
  }

  const from = searchParams.get('from');
  if (from) {
    const fromDate = new Date(from + 'T00:00:00+05:30');
    if (!isNaN(fromDate.getTime())) {
      extraWhere += ` AND c.closed_at >= $${paramIdx++}`;
      sqlParams.push(fromDate.toISOString());
    }
  }
  const to = searchParams.get('to');
  if (to) {
    const toDate = new Date(to + 'T23:59:59+05:30');
    if (!isNaN(toDate.getTime())) {
      extraWhere += ` AND c.closed_at <= $${paramIdx++}`;
      sqlParams.push(toDate.toISOString());
    }
  }
  const iqsMin = searchParams.get('iqs_min');
  if (iqsMin) { extraWhere += ` AND i.iqs_score >= $${paramIdx++}`; sqlParams.push(parseInt(iqsMin)); }
  const iqsMax = searchParams.get('iqs_max');
  if (iqsMax) { extraWhere += ` AND (i.iqs_score <= $${paramIdx++} OR (i.iqs_score IS NULL AND i.parameters ? '__agent_parameters'))`; sqlParams.push(parseInt(iqsMax)); }
  const csatValues = searchParams.getAll('csat');
  if (csatValues.length) {
    extraWhere += ` AND c.csat_score = ANY($${paramIdx++})`;
    sqlParams.push(csatValues.map(Number));
  }

  if (role === 'tl' || role === 'agent') {
    extraWhere += ` AND i.iqs_score IS NOT NULL`;
  }
  const statusFilter = searchParams.get('status');
  if (statusFilter === 'reviewed') {
    extraWhere += ` AND i.status = 'reviewed'`;
  } else if (['admin', 'quality'].includes(role)) {
    // Exclude chats that are in the pending review section of Chat Evaluation for QA and Admin views
    extraWhere += ` AND NOT (i.status IN ('pending', 'reopened') AND (i.iqs_score <= 85 OR (i.iqs_score IS NULL AND i.parameters ? '__agent_parameters')))`;
  }

  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  // TL is view-only — this lists all of their team's evaluated chats (not a
  // CAT2/action queue, which no longer exists now that TL doesn't score chats).
  const baseWhere = `a.name = ANY($1)`;
  const t0 = Date.now();

  const [countRow] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     WHERE ${baseWhere}${extraWhere}`,
    sqlParams
  );
  const total = parseInt(countRow?.total ?? '0');

  sqlParams.push(limit, offset);
  const rows = await query<{
    chat_id: string; agent_id: number | null; agent_name: string | null; iqs_score: string;
    closed_at: string; disposition: string; sub_disposition: string | null;
    csat_score: string | null; parameters: any; mobile_number: string | null;
    reviewed_by: string | null; reviewed_at: string | null;
    conversation_type: string | null;
  }>(
    `SELECT c.id AS chat_id, c.agent_id, a.name AS agent_name,
            i.iqs_score, c.closed_at,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            c.csat_score, i.parameters,
            ct.phone AS mobile_number,
            i.reviewed_by, i.reviewed_at, c.conversation_type
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE ${baseWhere}${extraWhere}
     ORDER BY c.closed_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    sqlParams
  );

  log.info(ROUTE, 'query', { total, page, limit, agentCount: agentNames.length, durationMs: Date.now() - t0 });

  const chats: TLChatRow[] = rows.map(r => {
    let params = r.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }
    const failedParams: string[] = [];
    for (const [dbKey, val] of Object.entries(params) as [string, any][]) {
      if (!dbKey.startsWith('__') && val?.score === false) {
        const pascal = ALL_DB_KEY_TO_PASCAL[dbKey];
        if (pascal) failedParams.push(pascal);
      }
    }
    let botIqsScore: number | null = null;
    let iqsScore: number | null = null;
    let callIqsScore: number | null = null;

    if (params.__scores) {
      botIqsScore = params.__scores.bot_iqs !== undefined && params.__scores.bot_iqs !== null ? parseFloat(params.__scores.bot_iqs) : null;
      iqsScore = params.__scores.agent_iqs !== undefined && params.__scores.agent_iqs !== null ? parseFloat(params.__scores.agent_iqs) : null;
      callIqsScore = params.__scores.call_iqs !== undefined && params.__scores.call_iqs !== null ? parseFloat(params.__scores.call_iqs) : null;
    }

    const isBotOnly = r.conversation_type === 'bot'
      || r.agent_name === 'Robylon AI'
      || r.agent_name === 'Robylon'
      || r.agent_name === 'Robylon Automation'
      || (r.agent_id !== null && [15, 447, 784].includes(Number(r.agent_id)));

    if (iqsScore === null && !isBotOnly) {
      iqsScore = computeIqsFromRawParams(params, false);
      if (iqsScore === null && r.iqs_score !== null && r.iqs_score !== undefined) {
        iqsScore = parseFloat(r.iqs_score);
      }
    }
    if (botIqsScore === null) {
      botIqsScore = computeIqsFromRawParams(params, true);
    }
    if (botIqsScore === null && r.iqs_score !== null && r.iqs_score !== undefined) {
      if (r.conversation_type === 'bot' || isBotOnly || params.__bot_parameters || params.__scores?.bot_iqs !== undefined) {
        botIqsScore = parseFloat(r.iqs_score);
      }
    }
    if (isBotOnly) {
      iqsScore = null;
    }

    return {
      chatId:         r.chat_id,
      agentName:      r.agent_name ?? 'Unknown',
      iqsScore,
      botIqsScore,
      callIqsScore,
      closedAt:       r.closed_at,
      disposition:    r.disposition,
      subDisposition: r.sub_disposition,
      csatScore:      r.csat_score ? parseInt(r.csat_score) : null,
      mobileNumber:   r.mobile_number ?? null,
      parameters:     params,
      failedParams,
      reviewedBy:     r.reviewed_by ?? null,
      reviewedAt:     r.reviewed_at ?? null,
      conversationType: r.conversation_type as any,
    };
  });

  return NextResponse.json({ chats, total, agents: agentNames });
});
