import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { DB_KEY_TO_LEGACY } from '@/lib/param-keys';
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
  const { session, response } = await requireRole(['tl', 'admin']);
  if (response) return response;
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  const { searchParams } = new URL(req.url);

  // Resolve TL's agents
  let agentNames: string[];
  if (role === 'admin') {
    const explicit = searchParams.get('agent');
    if (explicit) {
      agentNames = [explicit];
    } else {
      const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active'`);
      agentNames = rows.map(r => r.name);
    }
  } else {
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username) === email);
    const tlAgentName = configUser?.agentName ?? email;
    agentNames = await getAgentNamesByTL(tlAgentName);
    const agentFilter = searchParams.get('agent');
    if (agentFilter) agentNames = agentNames.filter(n => n === agentFilter);
  }

  if (!agentNames.length) {
    return NextResponse.json({ chats: [], total: 0, agents: [] });
  }

  const sqlParams: unknown[] = [agentNames];
  let paramIdx = 2;
  let extraWhere = '';

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
  if (iqsMax) { extraWhere += ` AND i.iqs_score <= $${paramIdx++}`; sqlParams.push(parseInt(iqsMax)); }
  const csatValues = searchParams.getAll('csat');
  if (csatValues.length) {
    extraWhere += ` AND c.csat_score = ANY($${paramIdx++})`;
    sqlParams.push(csatValues.map(Number));
  }

  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  // IQS < 85: anything below needs TL verification per the QA flow
  // Only surface chats with at least one CAT 2 param failure (TL's domain)
  const CAT2_DB_KEYS = ['contextual', 'sentences', 'grammar', 'empathy'];
  const cat2Filter = CAT2_DB_KEYS.map(k =>
    `(i.parameters->>'${k}' IS NOT NULL AND (i.parameters->'${k}'->>'score')::boolean = false)`
  ).join(' OR ');
  // tl_reviewed_by stored in parameters JSON as __tl_reviewed_by to avoid DB migration
  const baseWhere = `a.name = ANY($1) AND i.iqs_score < 85 AND (i.parameters->>'__tl_reviewed_by' IS NULL) AND (${cat2Filter})`;
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
    chat_id: string; agent_name: string | null; iqs_score: string;
    closed_at: string; disposition: string; sub_disposition: string | null;
    csat_score: string | null; parameters: any; mobile_number: string | null;
    reviewed_by: string | null; reviewed_at: string | null;
    conversation_type: string | null;
  }>(
    `SELECT c.id AS chat_id, a.name AS agent_name,
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
     ORDER BY i.iqs_score ASC, c.closed_at DESC
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
        const pascal = DB_KEY_TO_LEGACY[dbKey];
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

    if (iqsScore === null) {
      iqsScore = computeIqsFromRawParams(params, false);
    }
    if (botIqsScore === null) {
      botIqsScore = computeIqsFromRawParams(params, true);
    }
    if (botIqsScore === null && r.iqs_score !== null && r.iqs_score !== undefined) {
      if (r.conversation_type !== 'agent' || params.__bot_parameters || params.__scores?.bot_iqs !== undefined) {
        botIqsScore = parseFloat(r.iqs_score);
      }
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
