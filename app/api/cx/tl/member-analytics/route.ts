import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getAgentNamesByTL } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { getWeekStart, getLast8Weeks } from '@/lib/cx/week';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import { PASCAL_TO_DB, ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';

// ── Param definitions (mirrors team-analytics) ─────────────────────────────────
// Derived from lib/quality.ts so this route can never drift from the rubric again
// (the previous hand-copied list was v3-keyed and zeroed out the 5 v4-only params).
export const PARAM_DEFS = PARAM_ORDER.map(p => ({
  key: PASCAL_TO_DB[p] || p.toLowerCase(),
  label: PARAM_NAMES[p] ?? p,
  weight: Math.round((WEIGHTS[p] ?? 0) * 100),
}));

// Normalize any stored key spelling (canonical snake, old no-underscore v4, or
// PascalCase) to the canonical v4 db key. Legacy v3-only keys normalize to
// themselves, don't match a v4 def, and drop out — intentional: blending v3 rows
// into v4 pass rates would conflate two different rubrics.
export const normKey = (k: string) => {
  const pascal = ALL_DB_KEY_TO_PASCAL[k] ?? (PASCAL_TO_DB[k] ? k : undefined);
  return pascal ? (PASCAL_TO_DB[pascal] ?? k) : k;
};

// ── Date range ─────────────────────────────────────────────────────────────────
function getDateRange(period: string, from?: string | null, to?: string | null) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === '7')                    return { dateFrom: fmt(new Date(today.getTime() - 6 * 86400_000)), dateTo: fmt(today) };
  if (period === 'custom' && from && to) return { dateFrom: from, dateTo: to };
  return { dateFrom: fmt(new Date(today.getTime() - 29 * 86400_000)), dateTo: fmt(today) };
}

// ── WoW window: trailing 5 ISO weeks (always relative to today) ───────────────
function getWowWindow() {
  const currentWeek = getWeekStart();
  const last4 = getLast8Weeks().slice(0, 4).reverse();
  const weeks = [...last4, currentWeek];
  const d = new Date(currentWeek + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return { wowFrom: weeks[0], wowTo: d.toISOString().slice(0, 10), weeks };
}

// ── Shared SQL fragments ───────────────────────────────────────────────────────
const CHAT_SUMMARY_SELECT = `
  ROUND(COUNT(CASE WHEN c.csat_label='good' THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END),0)*100,1)::float AS csat_pct,
  ROUND(AVG(s.iqs_score)::numeric,1)::float AS iqs,
  COUNT(c.id)::int AS volume
`;

// v4 nests the human-leg params under __agent_parameters; legacy rows keep them at
// the top level. Iterate whichever container exists so both generations aggregate.
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

// Pass rate with half credit: v4 stores 0.5 for partial passes — count it as 0.5
// toward the numerator instead of an outright fail. Score compared as text only.
const PASS_RATE_SELECT = `
  p.key AS param_key,
  ROUND(SUM(CASE WHEN p.val->>'score'='true' THEN 1 WHEN p.val->>'score'='0.5' THEN 0.5 ELSE 0 END)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE p.val->>'score' IS NOT NULL AND p.val->>'score' NOT IN ('null','')),0)*100,1)::float AS pass_rate
`;

// ── Build WoW data ─────────────────────────────────────────────────────────────
function buildWow(
  sumRows:   { week_start: string; csat_pct: number|null; iqs: number|null; volume: number }[],
  paramRows: { week_start: string; param_key: string; pass_rate: number|null }[],
  weeks:     string[],
) {
  const sumMap = new Map(sumRows.map(r => [r.week_start, r]));
  const paramMap = new Map<string, Record<string, number|null>>();
  for (const r of paramRows) {
    const k = normKey(r.param_key);
    if (!paramMap.has(r.week_start)) paramMap.set(r.week_start, {});
    const pm = paramMap.get(r.week_start)!;
    if (pm[k] == null) pm[k] = r.pass_rate;
  }
  return weeks.map(w => {
    const s = sumMap.get(w);
    return { week_start: w, csat_pct: s?.csat_pct ?? null, iqs: s?.iqs ?? null, volume: s?.volume ?? 0, params: paramMap.get(w) ?? {} };
  });
}

// ── Build category tree ────────────────────────────────────────────────────────
interface FlatCatRow {
  disposition: string;
  sub_disposition: string | null;
  iqs: number | null;
  volume: number;
  resolution_seconds?: number | null;
}

interface CatSub {
  sub_disposition: string;
  chats_iqs: number|null; chats_volume: number; chats_resolution_seconds: number|null;
  calls_iqs: number|null; calls_volume: number;
}

export interface CatRow {
  disposition: string;
  chats_iqs: number|null; chats_volume: number; chats_resolution_seconds: number|null;
  calls_iqs: number|null; calls_volume: number;
  subs: CatSub[];
}

function buildCategories(
  chatParents: FlatCatRow[],
  chatSubs:    FlatCatRow[],
  callParents: FlatCatRow[],
  callSubs:    FlatCatRow[],
): CatRow[] {
  const map = new Map<string, CatRow>();

  for (const r of chatParents) {
    map.set(r.disposition, {
      disposition: r.disposition, chats_iqs: r.iqs, chats_volume: r.volume,
      chats_resolution_seconds: r.resolution_seconds ?? null, calls_iqs: null, calls_volume: 0, subs: [],
    });
  }
  for (const r of callParents) {
    if (!map.has(r.disposition)) {
      map.set(r.disposition, { disposition: r.disposition, chats_iqs: null, chats_volume: 0, chats_resolution_seconds: null, calls_iqs: r.iqs, calls_volume: r.volume, subs: [] });
    } else {
      const p = map.get(r.disposition)!;
      p.calls_iqs = r.iqs; p.calls_volume = r.volume;
    }
  }

  const chatSubMap = new Map<string, Map<string, FlatCatRow>>();
  const callSubMap = new Map<string, Map<string, FlatCatRow>>();
  for (const r of chatSubs) {
    if (r.sub_disposition) {
      if (!chatSubMap.has(r.disposition)) chatSubMap.set(r.disposition, new Map());
      chatSubMap.get(r.disposition)!.set(r.sub_disposition, r);
    }
  }
  for (const r of callSubs) {
    if (r.sub_disposition) {
      if (!callSubMap.has(r.disposition)) callSubMap.set(r.disposition, new Map());
      callSubMap.get(r.disposition)!.set(r.sub_disposition, r);
    }
  }

  for (const [disp, parent] of map.entries()) {
    const cs = chatSubMap.get(disp) ?? new Map<string, FlatCatRow>();
    const ls = callSubMap.get(disp) ?? new Map<string, FlatCatRow>();
    const subNames = new Set([...cs.keys(), ...ls.keys()]);
    parent.subs = Array.from(subNames).map(n => ({
      sub_disposition: n,
      chats_iqs:               cs.get(n)?.iqs ?? null,
      chats_volume:            cs.get(n)?.volume ?? 0,
      chats_resolution_seconds: cs.get(n)?.resolution_seconds ?? null,
      calls_iqs:               ls.get(n)?.iqs ?? null,
      calls_volume:            ls.get(n)?.volume ?? 0,
    })).sort((a, b) => b.chats_volume - a.chats_volume);
  }

  return Array.from(map.values()).sort((a, b) => b.chats_volume - a.chats_volume);
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userAny = session.user as Record<string, string | undefined>;
  const role = userAny.role;
  const email = userAny.email ?? '';
  if (role !== 'tl' && role !== 'admin' && role !== 'agent') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? '7';
  const { dateFrom, dateTo } = getDateRange(period, searchParams.get('from'), searchParams.get('to'));
  const { wowFrom, wowTo, weeks: wowWeeks } = getWowWindow();

  let tlAgentNames: string[];
  if (role === 'tl') {
    const config = await readConfig();
    const configUser = (config.users as any[]).find(u => (u.email || u.username) === email);
    const tlAgentName = configUser?.agentName ?? email;
    tlAgentNames = await getAgentNamesByTL(tlAgentName);
  } else {
    const rows = await query<{ name: string }>(`
      SELECT a.name
      FROM agents a
      LEFT JOIN conversations c ON c.agent_id = a.id AND c.closed_at >= NOW() - INTERVAL '60 days'
      WHERE a.status = 'active'
        AND a.name NOT IN ('Robylon', 'Robylon AI', 'Robylon Automation')
      GROUP BY a.name
      ORDER BY COUNT(c.id) DESC, a.name ASC
    `, []);
    tlAgentNames = rows.map(r => r.name);
    if (tlAgentNames.length === 0) {
      const fallback = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active' ORDER BY name ASC`, []);
      tlAgentNames = fallback.map(r => r.name);
    }
  }

  if (role === 'agent') {
    const config = await readConfig();
    const configUser = (config.users as any[]).find(u => (u.email || u.username) === email);
    const selfAgentName = configUser?.agentName || email.split('@')[0];
    tlAgentNames = selfAgentName ? [selfAgentName] : tlAgentNames.slice(0, 1);
  }

  if (tlAgentNames.length === 0) {
    return NextResponse.json({ agentName: null, agents: [], wowWeekStarts: wowWeeks, channels: { chats: null, calls: null, emails: null } });
  }

  const requestedAgent = searchParams.get('agent');
  const agentName = (requestedAgent && (tlAgentNames.includes(requestedAgent) || requestedAgent.length > 0))
    ? requestedAgent
    : tlAgentNames[0];

  // ── Run chats + calls queries in parallel ─────────────────────────────────────
  const [chatsRes, callsRes] = await Promise.all([
    Promise.all([
      query<{ csat_pct: number|null; iqs: number|null; volume: number }>(`
        SELECT ${CHAT_SUMMARY_SELECT}
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2 AND a.name = $3
      `, [dateFrom, dateTo, agentName]),

      query<FlatCatRow>(`
        SELECT c.tags->>'disposition' AS disposition,
               ROUND(AVG(s.iqs_score)::numeric,1)::float AS iqs,
               COUNT(c.id)::int AS volume,
               ROUND(AVG(c.resolution_seconds)::numeric)::int AS resolution_seconds
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
          AND a.name = $3 AND c.tags->>'disposition' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(c.id) DESC
      `, [dateFrom, dateTo, agentName]),

      query<FlatCatRow>(`
        SELECT c.tags->>'disposition' AS disposition,
               c.tags->>'sub_disposition' AS sub_disposition,
               ROUND(AVG(s.iqs_score)::numeric,1)::float AS iqs,
               COUNT(c.id)::int AS volume,
               ROUND(AVG(c.resolution_seconds)::numeric)::int AS resolution_seconds
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
          AND a.name = $3 AND c.tags->>'disposition' IS NOT NULL
          AND c.tags->>'sub_disposition' IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, COUNT(c.id) DESC
      `, [dateFrom, dateTo, agentName]),

      query<{ week_start: string; csat_pct: number|null; iqs: number|null; volume: number }>(`
        SELECT date_trunc('week', c.closed_at)::date::text AS week_start,
               ROUND(COUNT(CASE WHEN c.csat_label='good' THEN 1 END)::numeric /
                     NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END),0)*100,1)::float AS csat_pct,
               ROUND(AVG(s.iqs_score)::numeric,1)::float AS iqs,
               COUNT(c.id)::int AS volume
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE c.closed_at::date >= $1 AND c.closed_at::date < $2 AND a.name = $3
        GROUP BY 1 ORDER BY 1
      `, [wowFrom, wowTo, agentName]),

      query<{ week_start: string; param_key: string; pass_rate: number|null }>(`
        SELECT date_trunc('week', c.closed_at)::date::text AS week_start,
               ${PASS_RATE_SELECT}
        FROM iqs_scores s
        JOIN conversations c ON c.id = s.chat_id
        JOIN agents a ON a.id = c.agent_id
        ${CHAT_PARAM_LATERAL}
        WHERE c.closed_at::date >= $1 AND c.closed_at::date < $2
          AND a.name = $3 AND s.parameters IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1
      `, [wowFrom, wowTo, agentName]),
    ]),

    Promise.all([
      query<{ csat_pct: number|null; iqs: number|null; volume: number }>(`
        SELECT ROUND(COUNT(CASE WHEN c.csat_label='good' THEN 1 END)::numeric
                     / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END),0)*100,1)::float AS csat_pct,
               ROUND(AVG(s.call_iqs_score)::numeric,1)::float AS iqs,
               COUNT(cr.id)::int AS volume
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2 AND a.name = $3
      `, [dateFrom, dateTo, agentName]),

      query<FlatCatRow>(`
        SELECT c.tags->>'disposition' AS disposition,
               ROUND(AVG(s.call_iqs_score)::numeric,1)::float AS iqs,
               COUNT(cr.id)::int AS volume
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
          AND a.name = $3 AND c.tags->>'disposition' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(cr.id) DESC
      `, [dateFrom, dateTo, agentName]),

      query<FlatCatRow>(`
        SELECT c.tags->>'disposition' AS disposition,
               c.tags->>'sub_disposition' AS sub_disposition,
               ROUND(AVG(s.call_iqs_score)::numeric,1)::float AS iqs,
               COUNT(cr.id)::int AS volume
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
          AND a.name = $3 AND c.tags->>'disposition' IS NOT NULL
          AND c.tags->>'sub_disposition' IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, COUNT(cr.id) DESC
      `, [dateFrom, dateTo, agentName]),

      query<{ week_start: string; csat_pct: number|null; iqs: number|null; volume: number }>(`
        SELECT date_trunc('week', cr.called_at)::date::text AS week_start,
               ROUND(COUNT(CASE WHEN c.csat_label='good' THEN 1 END)::numeric /
                     NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END),0)*100,1)::float AS csat_pct,
               ROUND(AVG(s.call_iqs_score)::numeric,1)::float AS iqs,
               COUNT(cr.id)::int AS volume
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date < $2 AND a.name = $3
        GROUP BY 1 ORDER BY 1
      `, [wowFrom, wowTo, agentName]),

      query<{ week_start: string; param_key: string; pass_rate: number|null }>(`
        SELECT date_trunc('week', cr.called_at)::date::text AS week_start,
               ${PASS_RATE_SELECT}
        FROM iqs_scores s
        JOIN call_recordings cr ON cr.chat_id = s.chat_id
        LEFT JOIN conversations c ON c.id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        ${CALL_PARAM_LATERAL}
        WHERE cr.called_at::date >= $1 AND cr.called_at::date < $2
          AND a.name = $3 AND s.call_parameters IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1
      `, [wowFrom, wowTo, agentName]),
    ]),
  ]);

  const [chatStatRows, chatParents, chatSubs, chatWow, chatWowParams] = chatsRes;
  const [callStatRows, callParents, callSubs, callWow, callWowParams] = callsRes;

  const categories = buildCategories(
    chatParents as FlatCatRow[],
    chatSubs    as FlatCatRow[],
    callParents as FlatCatRow[],
    callSubs    as FlatCatRow[],
  );

  return NextResponse.json({
    agentName,
    agents:        tlAgentNames,
    dateFrom,
    dateTo,
    wowWeekStarts: wowWeeks,
    channels: {
      chats: {
        stats:      { csat_pct: chatStatRows[0]?.csat_pct ?? null, iqs: chatStatRows[0]?.iqs ?? null, volume: chatStatRows[0]?.volume ?? 0 },
        categories,
        wow:        buildWow(chatWow as any[], chatWowParams as any[], wowWeeks),
      },
      calls: {
        stats:      { csat_pct: callStatRows[0]?.csat_pct ?? null, iqs: callStatRows[0]?.iqs ?? null, volume: callStatRows[0]?.volume ?? 0 },
        categories,
        wow:        buildWow(callWow as any[], callWowParams as any[], wowWeeks),
      },
      emails: null,
    },
  });
}
