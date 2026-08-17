import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getAgentNamesByTL } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS, calculateWeightedOverallIQS } from '@/lib/quality';
import { PASCAL_TO_DB, ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';

// Canonical v4 parameter definitions, derived from lib/quality.ts so this route can
// never drift from the rubric again (the previous hand-copied list was v3-keyed and
// silently zeroed out the 5 v4-only parameters).
export const PARAM_DEFS = PARAM_ORDER.map(p => ({
  key: PASCAL_TO_DB[p] || p.toLowerCase(),
  label: PARAM_NAMES[p] ?? p,
  weight: Math.round((WEIGHTS[p] ?? 0) * 100),
}));

// The CALL rubric (lib/call-quality.ts) is a separate, unchanged pipeline that still
// stores v3-style keys — keep its defs independent so re-keying the chat defs to v4
// doesn't blank the calls panel.
const CALL_PARAM_DEFS = [
  { key: 'technical',     label: 'Technically / Legally Correct', weight: 20 },
  { key: 'all_questions', label: 'All Questions Addressed',       weight: 10 },
  { key: 'expectation',   label: 'Expectation Setting',           weight: 10 },
  { key: 'process',       label: 'Process',                       weight:  5 },
  { key: 'grammar',       label: 'Vocabulary & Grammar',          weight:  5 },
  { key: 'empathy',       label: 'Active Listening & Empathy',    weight: 10 },
  { key: 'call_opening',  label: 'Call Opening',                  weight:  5 },
  { key: 'call_closing',  label: 'Call Closing',                  weight:  5 },
  { key: 'fillers',       label: 'Fillers & Speech Clarity',      weight:  5 },
  { key: 'energy_tone',   label: 'Energy Level & Tone',           weight: 10 },
  { key: 'simplifying',   label: 'Simplifying Answers',           weight: 15 },
];

const normKey = (k: string) => {
  const pascal = ALL_DB_KEY_TO_PASCAL[k] ?? (PASCAL_TO_DB[k] ? k : undefined);
  return pascal ? (PASCAL_TO_DB[pascal] ?? k) : k;
};

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
    SUM(CASE WHEN p.val->>'score' = 'true' THEN 1 WHEN p.val->>'score' = '0.5' THEN 0.5 ELSE 0 END)::numeric
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
    CASE WHEN s.parameters::text LIKE '{%'
         THEN COALESCE(s.parameters::jsonb->'__agent_parameters', s.parameters::jsonb)
         ELSE '{}'::jsonb END
  ) AS p(key, val)
`;

const CALL_PARAM_LATERAL = `
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN s.call_parameters::text LIKE '{%' THEN s.call_parameters::jsonb ELSE '{}'::jsonb END
  ) AS p(key, val)
`;

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
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    let tlAgentName = configUser?.agentName;
    if (!tlAgentName && email) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(email).catch(() => null);
      if (dbUser?.name) tlAgentName = dbUser.name;
    }
    if (!tlAgentName) tlAgentName = email;
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

  const seenInData = new Set([...agentChatRows.map(a => a.agent_name), ...agentCallRows.map(a => a.agent_name)]);
  const allAgents = role === 'tl'
    ? agentNames.filter(n => seenInData.has(n) || true)
    : Array.from(seenInData).sort();

  const agents = allAgents.map(name => ({
    name,
    ini: name.split(' ').map((p: string) => p[0] ?? '').slice(0, 2).join('').toUpperCase() || '?',
    chats: {
      csat_pct: chatByAgent[name]?.csat_pct ?? null,
      iqs:      calculateWeightedOverallIQS(agentChatPM[name], 'human', { roundDecimals: 1 }) ?? (chatByAgent[name]?.iqs ?? null),
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

  const paramDefs = (defs: typeof PARAM_DEFS, teamPM: Record<string, number | null>, cxPM: Record<string, number | null>) =>
    defs.map(p => ({ ...p, team_score: teamPM[p.key] ?? null, cx_score: cxPM[p.key] ?? null }));

  const teamChatWeightedIqs = calculateWeightedOverallIQS(teamChatPM, 'human', { roundDecimals: 1 }) ?? (teamChatRow?.iqs ?? null);
  const cxChatWeightedIqs = calculateWeightedOverallIQS(cxChatPM, 'human', { roundDecimals: 1 }) ?? (cxChatRow?.iqs ?? null);

  return NextResponse.json({
    dateFrom,
    dateTo,
    agentCount: agents.length,
    tls: role === 'admin' ? allTLs : undefined,
    selectedTL,
    agents,
    channels: {
      chats: {
        team: { csat_pct: teamChatRow?.csat_pct ?? null, iqs: teamChatWeightedIqs, volume: teamChatRow?.volume ?? 0 },
        cx:   { csat_pct: cxChatRow?.csat_pct ?? null,   iqs: cxChatWeightedIqs,   volume: cxChatRow?.volume ?? 0 },
        params: paramDefs(PARAM_DEFS, teamChatPM, cxChatPM),
      },
      calls: {
        team: { csat_pct: teamCallRow?.csat_pct ?? null, iqs: teamCallRow?.iqs ?? null, volume: teamCallRow?.volume ?? 0 },
        cx:   { csat_pct: cxCallRow?.csat_pct ?? null,   iqs: cxCallRow?.iqs ?? null,   volume: cxCallRow?.volume ?? 0 },
        params: paramDefs(CALL_PARAM_DEFS, teamCallPM, cxCallPM),
      },
      emails: null,
    },
  });
}
