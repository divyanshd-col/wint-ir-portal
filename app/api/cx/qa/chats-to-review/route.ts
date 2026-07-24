import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { PASCAL_TO_DB, DB_KEY_TO_LEGACY } from '@/lib/param-keys';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { log, withLogging } from '@/lib/log';

const ROUTE = 'cx/qa/chats-to-review';

export interface ChatToReviewRow {
  chatId:        string;
  agentName:     string;
  iqsScore:      number | null;
  botIqsScore:   number | null;
  callIqsScore:  number | null;
  callTranscriptStatus: 'no_call' | 'pending' | 'transcribed';
  callTranscriptLabel: string;
  closedAt:      string;
  disposition:   string;
  subDisposition: string | null;
  csatScore:     number | null;
  mobileNumber:  string | null;
  parameters:    Record<string, { score: boolean | null; reasoning: string }>;
  failedParams:  string[]; // PascalCase keys where score === false
  // reviewed mode only
  reviewedBy?:   string | null;
  reviewedAt?:   string | null;
  reviewNote?:   string | null;
  status?:       string;
  conversationType?: 'bot' | 'agent' | 'hybrid';
  gates?:        any;
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const { session, response } = await requireRole(['quality', 'admin']);
  if (response) return response;
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  const { searchParams } = new URL(req.url);
  log.info(ROUTE, 'params', { raw: req.url.split('?')[1] ?? '' });

  // Resolve dispositions for this QA
  const config = await readConfig();
  let dispositions: string[];
  if (role === 'admin') {
    const explicit = searchParams.getAll('disposition');
    if (explicit.length) {
      dispositions = explicit;
    } else {
      const rows = await query<{ d: string }>(
        `SELECT DISTINCT tags->>'disposition' AS d FROM conversations
         WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''`
      );
      dispositions = rows.map(r => r.d);
    }
  } else {
    const map = config.qaDispositionMap ?? [];
    const entry = map.find(e => e.email.toLowerCase() === email.toLowerCase());
    dispositions = entry?.dispositions ?? [];
  }

  if (!dispositions.length) {
    log.warn(ROUTE, 'no dispositions', { email, role });
    return NextResponse.json({ chats: [], total: 0 });
  }

  // Reviewed vs pending mode
  const reviewedMode = searchParams.get('reviewed') === 'true';

  // Optional narrowing by one or more dispositions within the QA's set
  const dispositionFilters = searchParams.getAll('disposition_filter').filter(d => dispositions.includes(d));
  const effectiveDispositions = dispositionFilters.length ? dispositionFilters : dispositions;

  // Build dynamic WHERE clauses
  const sqlParams: unknown[] = [effectiveDispositions];
  let paramIdx = 2;
  let extraWhere = '';

  const filters: Record<string, unknown> = {};

  const chatId = searchParams.get('chat_id');
  if (chatId) {
    extraWhere += ` AND c.id LIKE $${paramIdx++}`;
    sqlParams.push(`${chatId.trim()}%`);
    filters.chatId = chatId.trim();
  }

  const subDispos = searchParams.getAll('sub_disposition');
  if (subDispos.length) {
    extraWhere += ` AND c.tags->>'sub_disposition' = ANY($${paramIdx++})`;
    sqlParams.push(subDispos);
    filters.subDispo = subDispos;
  }

  // Interpret dates as IST (UTC+05:30) so "June 2" means June 2 00:00 IST, not UTC midnight
  const from = searchParams.get('from');
  if (from) {
    const fromDate = new Date(from + 'T00:00:00+05:30');
    if (isNaN(fromDate.getTime())) {
      log.warn(ROUTE, 'invalid from date', { from });
    } else {
      const fromUTC = fromDate.toISOString();
      extraWhere += ` AND c.closed_at >= $${paramIdx++}`;
      sqlParams.push(fromUTC);
      filters.from = from;
      filters.fromUTC = fromUTC;
    }
  }

  const to = searchParams.get('to');
  if (to) {
    const toDate = new Date(to + 'T23:59:59+05:30');
    if (isNaN(toDate.getTime())) {
      log.warn(ROUTE, 'invalid to date', { to });
    } else {
      const toUTC = toDate.toISOString();
      extraWhere += ` AND c.closed_at <= $${paramIdx++}`;
      sqlParams.push(toUTC);
      filters.to = to;
      filters.toUTC = toUTC;
    }
  }

  const iqsMin = searchParams.get('iqs_min');
  if (iqsMin) {
    extraWhere += ` AND i.iqs_score >= $${paramIdx++}`;
    sqlParams.push(parseInt(iqsMin));
    filters.iqsMin = parseInt(iqsMin);
  }

  const iqsMax = searchParams.get('iqs_max');
  if (iqsMax !== null && iqsMax !== '') {
    extraWhere += ` AND i.iqs_score <= $${paramIdx++}`;
    sqlParams.push(parseInt(iqsMax));
    filters.iqsMax = parseInt(iqsMax);
  }

  const csatValues = searchParams.getAll('csat');
  if (csatValues.length) {
    extraWhere += ` AND c.csat_score = ANY($${paramIdx++})`;
    sqlParams.push(csatValues.map(Number));
    filters.csat = csatValues;
  }

  // param_fail: a PascalCase key like 'Technical' — filter to chats where that param scored false
  const paramFail = searchParams.get('param_fail');
  if (paramFail && PASCAL_TO_DB[paramFail]) {
    const dbKey = PASCAL_TO_DB[paramFail];
    extraWhere += ` AND (i.parameters->'${dbKey}'->>'score')::boolean = false`;
    filters.paramFail = paramFail;
  }

  // Status filter (e.g. 'reopened')
  const statusParam = searchParams.get('status');
  if (statusParam) {
    extraWhere += ` AND i.status = $${paramIdx++}`;
    sqlParams.push(statusParam);
    filters.status = statusParam;
  }

  // Agent / Interaction filter: bot_only | all | human_only | has_calls (default: human_only)
  const agentFilter = searchParams.get('agent_filter') || 'human_only';
  if (agentFilter === 'human_only') {
    extraWhere += ` AND (a.name IS NULL OR a.name != 'Robylon AI') AND (c.agent_id IS NULL OR c.agent_id NOT IN (15, 447, 784))`;
    filters.agentFilter = 'human_only';
  } else if (agentFilter === 'bot_only') {
    extraWhere += ` AND (a.name = 'Robylon AI' OR c.agent_id IN (15, 447, 784))`;
    filters.agentFilter = 'bot_only';
  } else if (agentFilter === 'has_calls') {
    extraWhere += ` AND EXISTS (
      SELECT 1 FROM call_recordings cr
      WHERE cr.chat_id = c.id
         OR (
           c.contact_id IS NOT NULL 
           AND cr.contact_id = c.contact_id 
           AND cr.called_at IS NOT NULL
           AND (c.started_at IS NULL OR cr.called_at >= c.started_at)
           AND (c.closed_at IS NULL OR cr.called_at <= c.closed_at)
         )
    )`;
    filters.agentFilter = 'has_calls';
  } else {
    filters.agentFilter = 'all';
  }

  // Has calls explicit filter: has_calls | no_calls | all
  const hasCallsParam = searchParams.get('has_calls') || searchParams.get('call_filter');
  if (hasCallsParam === 'has_calls' || hasCallsParam === 'true' || hasCallsParam === 'yes') {
    extraWhere += ` AND EXISTS (
      SELECT 1 FROM call_recordings cr
      WHERE cr.chat_id = c.id
         OR (
           c.contact_id IS NOT NULL 
           AND cr.contact_id = c.contact_id 
           AND cr.called_at IS NOT NULL
           AND (c.started_at IS NULL OR cr.called_at >= c.started_at)
           AND (c.closed_at IS NULL OR cr.called_at <= c.closed_at)
         )
    )`;
    filters.hasCalls = 'has_calls';
  } else if (hasCallsParam === 'no_calls' || hasCallsParam === 'false' || hasCallsParam === 'no') {
    extraWhere += ` AND NOT EXISTS (
      SELECT 1 FROM call_recordings cr
      WHERE cr.chat_id = c.id
         OR (
           c.contact_id IS NOT NULL 
           AND cr.contact_id = c.contact_id 
           AND cr.called_at IS NOT NULL
           AND (c.started_at IS NULL OR cr.called_at >= c.started_at)
           AND (c.closed_at IS NULL OR cr.called_at <= c.closed_at)
         )
    )`;
    filters.hasCalls = 'no_calls';
  }


  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const baseWhere = reviewedMode
    ? `c.tags->>'disposition' = ANY($1)
       AND i.status = 'reviewed'`
    : `c.tags->>'disposition' = ANY($1)
       AND i.status IN ('pending', 'reopened')
       AND i.iqs_score IS NOT NULL
       AND i.iqs_score <= 85`;

  log.info(ROUTE, 'query-plan', {
    role, email,
    reviewedMode,
    effectiveDispositions,
    extraWhere,
    sqlParams: JSON.stringify(sqlParams),
  });

  const t0 = Date.now();

  // Count query (needs LEFT JOIN agents to support include_robylon filter on agent name)
  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     WHERE ${baseWhere}${extraWhere}`,
    sqlParams
  );
  const total = parseInt(countRows[0]?.total ?? '0');

  // Data query
  sqlParams.push(limit, offset);
  const rows = await query<{
    chat_id: string;
    agent_id: number | null;
    agent_name: string | null;
    iqs_score: string | null;
    call_iqs_score: string | null;
    closed_at: string;
    disposition: string;
    sub_disposition: string | null;
    csat_score: string | null;
    parameters: any;
    mobile_number: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    status: string;
    contact_id: number | null;
    started_at: string | null;
    conversation_type: string | null;
  }>(
    `SELECT c.id AS chat_id, c.agent_id, a.name AS agent_name,
            i.iqs_score, i.call_iqs_score, c.closed_at,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            c.csat_score, i.parameters,
            ct.phone AS mobile_number,
            i.reviewed_by, i.reviewed_at, i.review_note, i.status,
            c.contact_id, c.started_at, c.conversation_type
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE ${baseWhere}${extraWhere}
     ORDER BY ${reviewedMode ? 'i.reviewed_at DESC' : 'i.scored_at DESC'}
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    sqlParams
  );

  log.info(ROUTE, 'query', {
    total, page, limit,
    dispositionCount: effectiveDispositions.length,
    durationMs: Date.now() - t0,
    ...filters,
  });

  // Query call recordings for these chats to check transcript statuses
  const chatIds = rows.map(r => r.chat_id);
  const contactIds = rows.map(r => r.contact_id).filter(Boolean);
  let callRecordings: any[] = [];
  if (chatIds.length > 0) {
    const sql = `
      SELECT id, chat_id, contact_id, called_at, transcript, recording_url
      FROM call_recordings
      WHERE chat_id = ANY($1)
         ${contactIds.length > 0 ? `OR contact_id = ANY($2)` : ''}
    `;
    const params = contactIds.length > 0 ? [chatIds, contactIds] : [chatIds];
    try {
      callRecordings = await query<any>(sql, params);
    } catch (e) {
      console.error('[chats-to-review] Failed to fetch call recordings for status check', e);
    }
  }

  // Batch fetch average call IQS from call_evaluations for these chats
  const callIqsAvgMap = new Map<string, number>();
  const callIdIqsMap = new Map<string, number>();

  if (chatIds.length > 0) {
    try {
      const evalRows = await query<{ chat_id: string; avg_iqs: string }>(
        `SELECT COALESCE(ce.chat_id, cr.chat_id) AS chat_id,
                ROUND(AVG(ce.iqs_percent))::int AS avg_iqs
         FROM call_evaluations ce
         LEFT JOIN call_recordings cr ON cr.id = ce.call_id
         WHERE (ce.chat_id = ANY($1) OR cr.chat_id = ANY($1))
           AND ce.iqs_percent IS NOT NULL
         GROUP BY COALESCE(ce.chat_id, cr.chat_id)`,
        [chatIds]
      );
      for (const er of evalRows) {
        if (er.chat_id && er.avg_iqs !== null && er.avg_iqs !== undefined) {
          callIqsAvgMap.set(er.chat_id, parseInt(er.avg_iqs, 10));
        }
      }
    } catch (e) {
      console.error('[chats-to-review] Failed to fetch call_evaluations avg_iqs', e);
    }
  }

  if (callRecordings.length > 0) {
    const recIds = callRecordings.map((cr: any) => cr.id);
    try {
      const callEvalRows = await query<{ call_id: string; iqs_percent: string }>(
        `SELECT call_id, iqs_percent FROM call_evaluations WHERE call_id = ANY($1) AND iqs_percent IS NOT NULL`,
        [recIds]
      );
      for (const cer of callEvalRows) {
        if (cer.call_id && cer.iqs_percent !== null && cer.iqs_percent !== undefined) {
          callIdIqsMap.set(cer.call_id, parseFloat(cer.iqs_percent));
        }
      }
    } catch (e) {
      console.error('[chats-to-review] Failed to fetch call_evaluations by call_id', e);
    }
  }

  // 3-stage lookup mapper to check call transcript status
  const getCallInfo = (chatId: string, contactId: number | null, startedAtStr: string | null, closedAtStr: string | null) => {
    const matched = callRecordings.filter(rec => {
      const calledAt = rec.called_at ? new Date(rec.called_at).getTime() : null;
      if (!calledAt) return false;
      const startedAt = startedAtStr ? new Date(startedAtStr).getTime() : 0;
      const closedAt = closedAtStr ? new Date(closedAtStr).getTime() : Date.now();
      
      // Strict timeframe: call must be initiated between chat startedAt and closedAt
      if (calledAt < startedAt || calledAt > closedAt) return false;

      if (rec.chat_id === chatId) return true;
      if (contactId && rec.contact_id === contactId) return true;
      return false;
    });

    if (matched.length === 0) {
      return { status: 'no_call' as const, label: 'No Call', matchedCallIds: [] as string[] };
    }

    const hasUntranscribed = matched.some(rec => {
      let isTranscribed = false;
      if (rec.transcript) {
        try {
          const parsed = typeof rec.transcript === 'string' ? JSON.parse(rec.transcript) : rec.transcript;
          isTranscribed = Array.isArray(parsed) && parsed.length > 0;
        } catch {}
      }
      return !isTranscribed && rec.recording_url;
    });

    const matchedCallIds = matched.map((r: any) => r.id);

    if (hasUntranscribed) {
      return { status: 'pending' as const, label: 'Pending Transcription', matchedCallIds };
    } else {
      return { status: 'transcribed' as const, label: 'Transcribed', matchedCallIds };
    }
  };



  const chats: ChatToReviewRow[] = rows.map(r => {
    let params = r.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    const failedParams: string[] = [];
    const safeAgentParams = params.__agent_parameters || params;
    for (const [dbKey, val] of Object.entries(safeAgentParams) as [string, any][]) {
      if (dbKey.startsWith('__')) continue;
      if (val?.score === false) {
        const pascal = DB_KEY_TO_LEGACY[dbKey];
        if (pascal) failedParams.push(pascal);
      }
    }

    const callInfo = getCallInfo(r.chat_id, r.contact_id, r.started_at, r.closed_at);

    const isBot = r.conversation_type === 'bot' || r.agent_name === 'Robylon AI' || (r.agent_id !== null && [15, 447, 784].includes(Number(r.agent_id)));

    let botIqsScore: number | null = null;
    let iqsScore: number | null = null;
    let callIqsScore: number | null = null;

    if (params.__scores) {
      botIqsScore = params.__scores.bot_iqs !== undefined && params.__scores.bot_iqs !== null ? parseFloat(params.__scores.bot_iqs) : null;
      iqsScore = params.__scores.agent_iqs !== undefined && params.__scores.agent_iqs !== null ? parseFloat(params.__scores.agent_iqs) : null;
    } else {
      if (isBot) {
        botIqsScore = r.iqs_score !== null ? parseFloat(r.iqs_score) : null;
        iqsScore = null;
      } else {
        iqsScore = r.iqs_score !== null ? parseFloat(r.iqs_score) : null;
        botIqsScore = null;
      }
    }

    // Safety fallback for bot-only vs agent-only chats
    if (isBot) {
      if (botIqsScore === null && iqsScore !== null) {
        botIqsScore = iqsScore;
      }
      iqsScore = null;
    } else if (r.conversation_type === 'agent') {
      if (iqsScore === null && botIqsScore !== null) {
        iqsScore = botIqsScore;
      }
      botIqsScore = null;
    }

    // Call IQS is the average IQS of all calls under that chat ID
    const matchedScores = callInfo.matchedCallIds
      .map(id => callIdIqsMap.get(id))
      .filter((s): s is number => s !== undefined && s !== null);

    if (matchedScores.length > 0) {
      callIqsScore = Math.round(matchedScores.reduce((a, b) => a + b, 0) / matchedScores.length);
    } else if (callIqsAvgMap.has(r.chat_id)) {
      callIqsScore = callIqsAvgMap.get(r.chat_id)!;
    } else if (params.__scores && params.__scores.call_iqs !== undefined && params.__scores.call_iqs !== null) {
      callIqsScore = parseFloat(params.__scores.call_iqs);
    } else if (r.call_iqs_score !== null) {
      callIqsScore = parseFloat(r.call_iqs_score);
    }

    return {
      chatId:         r.chat_id,
      agentName:      r.agent_name ?? 'Unknown',
      iqsScore,
      botIqsScore,
      callIqsScore,
      callTranscriptStatus: callInfo.status,
      callTranscriptLabel: callInfo.label,
      closedAt:       r.closed_at,
      disposition:    r.disposition,
      subDisposition: r.sub_disposition,
      csatScore:      r.csat_score ? parseInt(r.csat_score) : null,
      mobileNumber:   r.mobile_number ?? null,
      parameters:     params,
      failedParams,
      reviewedBy:     r.reviewed_by ?? null,
      reviewedAt:     r.reviewed_at ?? null,
      reviewNote:     r.review_note ?? null,
      status:         r.status,
      conversationType: r.conversation_type as any,
      gates:          params.__gates || params.gates || null,
    };
  });

  return NextResponse.json({ chats, total });
});
