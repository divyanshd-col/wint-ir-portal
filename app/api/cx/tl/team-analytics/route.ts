import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getAgentNamesByTL } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';

// Canonical parameter definitions (order matches quality.ts PARAM_ORDER)
export const PARAM_DEFS = [
  { key: 'technical',               label: 'Accuracy',                             weight: 20 },
  { key: 'all_questions',           label: 'Issue Resolution',                     weight: 25 },
  { key: 'expectation',             label: 'Expectation Setting & Follow-Through', weight: 20 },
  { key: 'dissatisfactionhandling', label: 'Dissatisfaction Handling',             weight: 10 },
  { key: 'contextual',              label: 'Contextual & Personalization',         weight: 10 },
  { key: 'follow_up',               label: 'Post-Call Recap / Follow-up',          weight:  5 },
  { key: 'sentences',               label: 'Readability & Tone',                   weight:  3 },
  { key: 'process',                 label: 'Process-wise',                         weight:  0 },
  { key: 'opening',                 label: 'Greeting & Handover',                  weight:  2 },
  { key: 'call',                    label: 'Call Escalation Decision',             weight:  5 },
  { key: 'grammar',                 label: 'Grammar / Structure',                  weight:  0 },
  { key: 'empathy',                 label: 'Empathy',                              weight:  5 },
];

// DB stores param keys in historical PascalCase, V4 camelCase, and snake_case formats
const PASCAL_TO_SNAKE: Record<string, string> = {
  Technical: 'technical', Accuracy: 'technical', technical: 'technical', accuracy: 'technical',
  AllQuestions: 'all_questions', IssueResolution: 'all_questions', all_questions: 'all_questions', issue_resolution: 'all_questions',
  Expectation: 'expectation', ExpectationFollowThrough: 'expectation', expectation: 'expectation', expectationfollowthrough: 'expectation',
  DissatisfactionHandling: 'dissatisfactionhandling', dissatisfactionhandling: 'dissatisfactionhandling', dissatisfaction_handling: 'dissatisfactionhandling',
  Contextual: 'contextual', Personalization: 'contextual', contextual: 'contextual', personalization: 'contextual',
  FollowUp: 'follow_up', PostCallRecap: 'follow_up', follow_up: 'follow_up', postcallrecap: 'follow_up',
  Sentences: 'sentences', Readability: 'sentences', sentences: 'sentences', readability: 'sentences',
  Process: 'process', process: 'process',
  Opening: 'opening', GreetingHandover: 'opening', opening: 'opening', greetinghandover: 'opening',
  Call: 'call', EscalationDecision: 'call', call: 'call', escalationdecision: 'call',
  Grammar: 'grammar', grammar: 'grammar',
  Empathy: 'empathy', empathy: 'empathy',
};
const normKey = (k: string) => PASCAL_TO_SNAKE[k] ?? k;

function getDateRange(period: string, from?: string | null, to?: string | null) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (period === '7') {
    const start = new Date(today.getTime() - 6 * 86400_000);
    return { dateFrom: fmt(start), dateTo: fmt(today) };
  }
  if (period === 'custom' && from && to) {
    return { dateFrom: from, dateTo: to };
  }
  // '30' (default)
  const start = new Date(today.getTime() - 29 * 86400_000);
  return { dateFrom: fmt(start), dateTo: fmt(today) };
}

// ── Shared SQL fragments ───────────────────────────────────────────────────────

const CHAT_SUMMARY_SELECT = `
  ROUND(
    COUNT(CASE WHEN c.csat_label = 'good' THEN 1 END)::numeric
    / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
  )::float AS csat_pct,
  ROUND(AVG(s.iqs_score)::numeric, 1)::float AS iqs,
  COUNT(c.id)::int AS volume
`;

const CHAT_PARAM_SELECT = `
  p.key AS param_key,
  ROUND(
    COUNT(*) FILTER (WHERE (p.val->>'score') = 'true')::numeric
    / NULLIF(
        COUNT(*) FILTER (WHERE p.val->>'score' IS NOT NULL AND p.val->>'score' NOT IN ('null','')),
        0
      ) * 100, 1
  )::float AS pass_rate
`;

const CHAT_PARAM_FROM = `
  iqs_scores s
  JOIN conversations c ON c.id = s.chat_id
`;

const CHAT_PARAM_LATERAL = `
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN s.parameters::text LIKE '{%' THEN s.parameters::jsonb ELSE '{}'::jsonb END
  ) AS p(key, val)
`;

const CALL_PARAM_LATERAL = `
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN s.call_parameters::text LIKE '{%' THEN s.call_parameters::jsonb ELSE '{}'::jsonb END
  ) AS p(key, val)
`;

// ── Main handler ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userAny = session.user as Record<string, string | undefined>;
  const role  = userAny.role;
  const email = userAny.email ?? '';
  if (role !== 'tl' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'current';
  const { dateFrom, dateTo } = getDateRange(period, searchParams.get('from'), searchParams.get('to'));

  // ── Resolve list of TLs ──────────────────────────────────────────────────────
  const config = await readConfig();
  const configTLs = (config.users as any[])
    .filter(u => u.role === 'tl')
    .map(u => u.agentName || u.name || u.email)
    .filter(Boolean);

  const dbTLsRows = await query<{ tl_name: string }>(`
    SELECT DISTINCT tl_name
    FROM agents
    WHERE tl_name IS NOT NULL AND tl_name != ''
    ORDER BY tl_name
  `, []);
  const dbTLs = dbTLsRows.map(r => r.tl_name);

  const allTLs = Array.from(new Set([...configTLs, ...dbTLs])).sort();

  // ── Resolve agent names ──────────────────────────────────────────────────────
  let agentNames: string[];
  let selectedTL: string | null = null;

  if (role === 'admin') {
    const requestedTL = searchParams.get('tl');
    selectedTL = (requestedTL && allTLs.includes(requestedTL)) ? requestedTL : (allTLs[0] ?? null);
    if (selectedTL) {
      agentNames = await getAgentNamesByTL(selectedTL);
    } else {
      const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active'`, []);
      agentNames = rows.map(r => r.name);
    }
  } else {
    const configUser = config.users.find(u => (u.email || u.username) === email);
    const tlAgentName = configUser?.agentName ?? email;
    selectedTL = tlAgentName;
    agentNames = await getAgentNamesByTL(tlAgentName);
  }

  if (agentNames.length === 0) {
    return NextResponse.json({
      dateFrom, dateTo, agentCount: 0,
      tls: role === 'admin' ? allTLs : undefined,
      selectedTL,
      agents: [],
      channels: {
        chats: { team: { csat_pct: null, iqs: null, volume: 0 }, cx: { csat_pct: null, iqs: null, volume: 0 }, params: PARAM_DEFS.map(p => ({ ...p, team_score: null, cx_score: null })) },
        calls: { team: { csat_pct: null, iqs: null, volume: 0 }, cx: { csat_pct: null, iqs: null, volume: 0 }, params: PARAM_DEFS.map(p => ({ ...p, team_score: null, cx_score: null })) },
        emails: null,
      },
    });
  }

  // ── CHATS CHANNEL ────────────────────────────────────────────────────────────

  const [teamChatRow] = await query<{ csat_pct: number | null; iqs: number | null; volume: number }>(`
    SELECT ${CHAT_SUMMARY_SELECT}
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2 AND a.name = ANY($3)
  `, [dateFrom, dateTo, agentNames]);

  const [cxChatRow] = await query<{ csat_pct: number | null; iqs: number | null; volume: number }>(`
    SELECT ${CHAT_SUMMARY_SELECT}
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
  `, [dateFrom, dateTo]);

  const teamChatParams = await query<{ param_key: string; pass_rate: number | null }>(`
    SELECT ${CHAT_PARAM_SELECT}
    FROM ${CHAT_PARAM_FROM}
    JOIN agents a ON a.id = c.agent_id
    ${CHAT_PARAM_LATERAL}
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
      AND a.name = ANY($3) AND s.parameters IS NOT NULL
    GROUP BY p.key
  `, [dateFrom, dateTo, agentNames]);

  const cxChatParams = await query<{ param_key: string; pass_rate: number | null }>(`
    SELECT ${CHAT_PARAM_SELECT}
    FROM ${CHAT_PARAM_FROM}
    ${CHAT_PARAM_LATERAL}
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2 AND s.parameters IS NOT NULL
    GROUP BY p.key
  `, [dateFrom, dateTo]);

  const agentChatRows = await query<{ agent_name: string; csat_pct: number | null; iqs: number | null; volume: number }>(`
    SELECT a.name AS agent_name, ${CHAT_SUMMARY_SELECT}
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2 AND a.name = ANY($3)
    GROUP BY a.name ORDER BY a.name
  `, [dateFrom, dateTo, agentNames]);

  const agentChatParamRows = await query<{ agent_name: string; param_key: string; pass_rate: number | null }>(`
    SELECT a.name AS agent_name, ${CHAT_PARAM_SELECT}
    FROM ${CHAT_PARAM_FROM}
    JOIN agents a ON a.id = c.agent_id
    ${CHAT_PARAM_LATERAL}
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
      AND a.name = ANY($3) AND s.parameters IS NOT NULL
    GROUP BY a.name, p.key
  `, [dateFrom, dateTo, agentNames]);

  // ── CALLS CHANNEL ────────────────────────────────────────────────────────────

  const [teamCallRow] = await query<{ csat_pct: number | null; iqs: number | null; volume: number }>(`
    SELECT
      ROUND(
        COUNT(CASE WHEN c.csat_label = 'good' THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS csat_pct,
      ROUND(AVG(s.call_iqs_score)::numeric, 1)::float AS iqs,
      COUNT(cr.id)::int AS volume
    FROM call_recordings cr
    LEFT JOIN conversations c ON c.id = cr.chat_id
    LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
    JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
    WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2 AND a.name = ANY($3)
  `, [dateFrom, dateTo, agentNames]);

  const [cxCallRow] = await query<{ csat_pct: number | null; iqs: number | null; volume: number }>(`
    SELECT
      ROUND(
        COUNT(CASE WHEN c.csat_label = 'good' THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS csat_pct,
      ROUND(AVG(s.call_iqs_score)::numeric, 1)::float AS iqs,
      COUNT(cr.id)::int AS volume
    FROM call_recordings cr
    LEFT JOIN conversations c ON c.id = cr.chat_id
    LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
    WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
  `, [dateFrom, dateTo]);

  const teamCallParams = await query<{ param_key: string; pass_rate: number | null }>(`
    SELECT ${CHAT_PARAM_SELECT}
    FROM iqs_scores s
    JOIN call_recordings cr ON cr.chat_id = s.chat_id
    LEFT JOIN conversations c ON c.id = cr.chat_id
    JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
    ${CALL_PARAM_LATERAL}
    WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
      AND a.name = ANY($3) AND s.call_parameters IS NOT NULL
    GROUP BY p.key
  `, [dateFrom, dateTo, agentNames]);

  const cxCallParams = await query<{ param_key: string; pass_rate: number | null }>(`
    SELECT ${CHAT_PARAM_SELECT}
    FROM iqs_scores s
    JOIN call_recordings cr ON cr.chat_id = s.chat_id
    ${CALL_PARAM_LATERAL}
    WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2 AND s.call_parameters IS NOT NULL
    GROUP BY p.key
  `, [dateFrom, dateTo]);

  const agentCallRows = await query<{ agent_name: string; csat_pct: number | null; iqs: number | null; volume: number }>(`
    SELECT
      a.name AS agent_name,
      ROUND(
        COUNT(CASE WHEN c.csat_label = 'good' THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS csat_pct,
      ROUND(AVG(s.call_iqs_score)::numeric, 1)::float AS iqs,
      COUNT(cr.id)::int AS volume
    FROM call_recordings cr
    LEFT JOIN conversations c ON c.id = cr.chat_id
    LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
    JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
    WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2 AND a.name = ANY($3)
    GROUP BY a.name ORDER BY a.name
  `, [dateFrom, dateTo, agentNames]);

  const agentCallParamRows = await query<{ agent_name: string; param_key: string; pass_rate: number | null }>(`
    SELECT a.name AS agent_name, ${CHAT_PARAM_SELECT}
    FROM iqs_scores s
    JOIN call_recordings cr ON cr.chat_id = s.chat_id
    LEFT JOIN conversations c ON c.id = cr.chat_id
    JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
    ${CALL_PARAM_LATERAL}
    WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
      AND a.name = ANY($3) AND s.call_parameters IS NOT NULL
    GROUP BY a.name, p.key
  `, [dateFrom, dateTo, agentNames]);

  // ── Build response ────────────────────────────────────────────────────────────

  function mapToParamScores(rows: { param_key: string; pass_rate: number | null }[]) {
    const out: Record<string, number | null> = {};
    for (const r of rows) {
      const k = normKey(r.param_key);
      // keep the first non-null value if both formats appear for the same logical key
      if (out[k] == null) out[k] = r.pass_rate;
    }
    return out;
  }

  const teamChatPM = mapToParamScores(teamChatParams);
  const cxChatPM   = mapToParamScores(cxChatParams);
  const teamCallPM = mapToParamScores(teamCallParams);
  const cxCallPM   = mapToParamScores(cxCallParams);

  // Per-agent params grouped by channel
  const agentChatPM: Record<string, Record<string, number | null>> = {};
  for (const r of agentChatParamRows) {
    const k = normKey(r.param_key);
    if (!agentChatPM[r.agent_name]) agentChatPM[r.agent_name] = {};
    if (agentChatPM[r.agent_name][k] == null) agentChatPM[r.agent_name][k] = r.pass_rate;
  }
  const agentCallPM: Record<string, Record<string, number | null>> = {};
  for (const r of agentCallParamRows) {
    const k = normKey(r.param_key);
    if (!agentCallPM[r.agent_name]) agentCallPM[r.agent_name] = {};
    if (agentCallPM[r.agent_name][k] == null) agentCallPM[r.agent_name][k] = r.pass_rate;
  }

  // Summaries keyed by agent name
  const chatByAgent = Object.fromEntries(agentChatRows.map(a => [a.agent_name, a]));
  const callByAgent = Object.fromEntries(agentCallRows.map(a => [a.agent_name, a]));

  // Union of all agents (anchored to agentNames list for TL scoping)
  const seenInData = new Set([...agentChatRows.map(a => a.agent_name), ...agentCallRows.map(a => a.agent_name)]);
  // Include all TL agents even if no data in period; for admin just use what appeared
  const allAgents = role === 'tl'
    ? agentNames.filter(n => seenInData.has(n) || true) // keep all assigned agents
    : Array.from(seenInData).sort();

  const agents = allAgents.map(name => ({
    name,
    ini: name.split(' ').map((p: string) => p[0] ?? '').slice(0, 2).join('').toUpperCase() || '?',
    chats: {
      csat_pct: chatByAgent[name]?.csat_pct ?? null,
      iqs:      chatByAgent[name]?.iqs ?? null,
      volume:   chatByAgent[name]?.volume ?? 0,
      params:   agentChatPM[name] ?? {},
    },
    calls: {
      csat_pct: callByAgent[name]?.csat_pct ?? null,
      iqs:      callByAgent[name]?.iqs ?? null,
      volume:   callByAgent[name]?.volume ?? 0,
      params:   agentCallPM[name] ?? {},
    },
    emails: null,
  }));

  const paramDefs = (teamPM: Record<string, number | null>, cxPM: Record<string, number | null>) =>
    PARAM_DEFS.map(p => ({ ...p, team_score: teamPM[p.key] ?? null, cx_score: cxPM[p.key] ?? null }));

  return NextResponse.json({
    dateFrom,
    dateTo,
    agentCount: agents.length,
    tls: role === 'admin' ? allTLs : undefined,
    selectedTL,
    agents,
    channels: {
      chats: {
        team: { csat_pct: teamChatRow?.csat_pct ?? null, iqs: teamChatRow?.iqs ?? null, volume: teamChatRow?.volume ?? 0 },
        cx:   { csat_pct: cxChatRow?.csat_pct ?? null,   iqs: cxChatRow?.iqs ?? null,   volume: cxChatRow?.volume ?? 0 },
        params: paramDefs(teamChatPM, cxChatPM),
      },
      calls: {
        team: { csat_pct: teamCallRow?.csat_pct ?? null, iqs: teamCallRow?.iqs ?? null, volume: teamCallRow?.volume ?? 0 },
        cx:   { csat_pct: cxCallRow?.csat_pct ?? null,   iqs: cxCallRow?.iqs ?? null,   volume: cxCallRow?.volume ?? 0 },
        params: paramDefs(teamCallPM, cxCallPM),
      },
      emails: null,
    },
  });
}
