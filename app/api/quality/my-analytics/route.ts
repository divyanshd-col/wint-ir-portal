import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { PARAM_ORDER, PARAM_NAMES } from '@/lib/quality';

function avgOrNull(nums: number[]): number | null {
  const valid = nums.filter(n => n != null && !isNaN(n));
  if (!valid.length) return null;
  return Math.round(valid.reduce((s, n) => s + n, 0) / valid.length);
}

function pctOrNull(goods: number, total: number): number | null {
  if (!total) return null;
  return Math.round((goods / total) * 100);
}

// Get ISO week start (Monday) for a date
function weekStart(d: Date): string {
  const day = d.getUTCDay() || 7;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - day + 1);
  mon.setUTCHours(0, 0, 0, 0);
  return mon.toISOString().slice(0, 10);
}

function weekLabel(monKey: string): string {
  const mon = new Date(monKey + 'T00:00:00Z');
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function trailing5Weeks(): string[] {
  const today = new Date();
  const thisMon = weekStart(today);
  const weeks: string[] = [];
  for (let i = 4; i >= 0; i--) {
    const mon = new Date(thisMon + 'T00:00:00Z');
    mon.setUTCDate(mon.getUTCDate() - i * 7);
    weeks.push(mon.toISOString().slice(0, 10));
  }
  return weeks;
}

const DB_KEY_TO_PARAM: Record<string, string> = {
  technical:                'Technical',
  accuracy:                 'Technical',
  Technical:                'Technical',
  all_questions:            'AllQuestions',
  issue_resolution:         'AllQuestions',
  AllQuestions:             'AllQuestions',
  expectation:              'Expectation',
  expectationfollowthrough: 'Expectation',
  Expectation:              'Expectation',
  dissatisfactionhandling:  'DissatisfactionHandling',
  dissatisfaction_handling: 'DissatisfactionHandling',
  DissatisfactionHandling:  'DissatisfactionHandling',
  contextual:               'Contextual',
  personalization:          'Contextual',
  Contextual:               'Contextual',
  follow_up:                'FollowUp',
  postcallrecap:            'FollowUp',
  FollowUp:                 'FollowUp',
  sentences:                'Sentences',
  readability:              'Sentences',
  Sentences:                'Sentences',
  process:                  'Process',
  Process:                  'Process',
  opening:                  'Opening',
  greetinghandover:         'Opening',
  Opening:                  'Opening',
  call:                     'Call',
  escalationdecision:       'Call',
  Call:                     'Call',
  grammar:                  'Grammar',
  Grammar:                  'Grammar',
  empathy:                  'Empathy',
  Empathy:                  'Empathy',
};

function normalizeParamKey(raw: string): string {
  return DB_KEY_TO_PARAM[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1));
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '30';
  const customFrom = searchParams.get('from') || '';
  const customTo   = searchParams.get('to')   || '';

  // Resolve agent name from config
  const config = await readConfig();
  const email = session.user.email || '';
  const configUser = config.users.find(u => (u.email || u.username) === email);
  const agentName = configUser?.agentName || '';
  if (!agentName) {
    return NextResponse.json({ error: 'Agent not configured' }, { status: 404 });
  }

  // Compute period date range
  const today = new Date().toISOString().slice(0, 10);
  let dateFrom: string;
  let dateTo: string = today;

  if (period === 'custom' && customFrom && customTo) {
    dateFrom = customFrom;
    dateTo   = customTo;
  } else if (period === '7') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    dateFrom = d.toISOString().slice(0, 10);
  } else {
    // default: 30 days
    const d = new Date(); d.setDate(d.getDate() - 29);
    dateFrom = d.toISOString().slice(0, 10);
  }

  // ── Stat cards (period-scoped) ──────────────────────────────────────────────
  // Chat stats from conversations + iqs_scores
  const chatStatRows = await query<{
    total: string; with_iqs: string; avg_iqs: string;
    csat_good: string; csat_total: string;
  }>(`
    SELECT
      COUNT(c.id)::text                                                AS total,
      COUNT(s.iqs_score)::text                                         AS with_iqs,
      AVG(s.iqs_score)::text                                           AS avg_iqs,
      COUNT(CASE WHEN c.csat_score = 5 THEN 1 END)::text              AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) THEN 1 END)::text       AS csat_total
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE a.name = $1
      AND c.closed_at::date >= $2
      AND c.closed_at::date <= $3
  `, [agentName, dateFrom, dateTo]);

  // Call stats
  const callStatRows = await query<{
    call_vol: string; avg_call_iqs: string; csat_good: string; csat_total: string;
  }>(`
    SELECT
      COUNT(cr.id)::text                                                AS call_vol,
      AVG(s.call_iqs_score)::text                                       AS avg_call_iqs,
      COUNT(CASE WHEN c.csat_score = 5 THEN 1 END)::text               AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) THEN 1 END)::text        AS csat_total
    FROM call_recordings cr
    JOIN agents a ON a.id = cr.agent_id
    JOIN conversations c ON c.id = cr.chat_id
    LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
    WHERE a.name = $1
      AND cr.called_at::date >= $2
      AND cr.called_at::date <= $3
  `, [agentName, dateFrom, dateTo]);

  const cs = chatStatRows[0];
  const ks = callStatRows[0];

  const statCards = {
    chats: {
      volume: parseInt(cs?.total ?? '0'),
      iqs:    cs?.avg_iqs ? Math.round(parseFloat(cs.avg_iqs)) : null,
      csat:   pctOrNull(parseInt(cs?.csat_good ?? '0'), parseInt(cs?.csat_total ?? '0')),
    },
    calls: {
      volume: parseInt(ks?.call_vol ?? '0'),
      iqs:    ks?.avg_call_iqs ? Math.round(parseFloat(ks.avg_call_iqs)) : null,
      csat:   pctOrNull(parseInt(ks?.csat_good ?? '0'), parseInt(ks?.csat_total ?? '0')),
    },
    emails: { volume: 0, iqs: null, csat: null },
  };

  // ── Category tree (period-scoped, chat IQS only) ────────────────────────────
  const catRows = await query<{
    disposition: string; sub_disposition: string;
    avg_iqs: string; avg_res: string; count: string;
  }>(`
    SELECT
      COALESCE(c.tags->>'disposition', 'Other')          AS disposition,
      COALESCE(c.tags->>'sub_disposition', '')            AS sub_disposition,
      AVG(s.iqs_score)::text                              AS avg_iqs,
      AVG(c.resolution_seconds)::text                     AS avg_res,
      COUNT(c.id)::text                                   AS count
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE a.name = $1
      AND c.closed_at::date >= $2
      AND c.closed_at::date <= $3
      AND s.iqs_score IS NOT NULL
    GROUP BY 1, 2
    ORDER BY SUM(1) DESC
  `, [agentName, dateFrom, dateTo]);

  // Build disposition tree
  const dispMap: Record<string, {
    iqsVals: number[]; resVals: number[]; count: number;
    subs: Record<string, { iqsVals: number[]; resVals: number[]; count: number }>;
  }> = {};

  for (const r of catRows) {
    const d = r.disposition || 'Other';
    if (!dispMap[d]) dispMap[d] = { iqsVals: [], resVals: [], count: 0, subs: {} };
    const iqs = r.avg_iqs ? parseFloat(r.avg_iqs) : null;
    const res = r.avg_res ? parseFloat(r.avg_res) : null;
    const cnt = parseInt(r.count ?? '0');
    dispMap[d].count += cnt;
    if (iqs != null) dispMap[d].iqsVals.push(iqs);
    if (res != null) dispMap[d].resVals.push(res);

    const sub = r.sub_disposition;
    if (sub) {
      if (!dispMap[d].subs[sub]) dispMap[d].subs[sub] = { iqsVals: [], resVals: [], count: 0 };
      dispMap[d].subs[sub].count += cnt;
      if (iqs != null) dispMap[d].subs[sub].iqsVals.push(iqs);
      if (res != null) dispMap[d].subs[sub].resVals.push(res);
    }
  }

  const categories = Object.entries(dispMap)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([disp, d]) => ({
      disposition: disp,
      iqsChats: avgOrNull(d.iqsVals),
      resolutionSecs: avgOrNull(d.resVals),
      children: Object.entries(d.subs)
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([name, s]) => ({
          name,
          iqsChats: avgOrNull(s.iqsVals),
          resolutionSecs: avgOrNull(s.resVals),
        })),
    }));

  // ── Week-on-Week (trailing 5 weeks, always) ─────────────────────────────────
  const wowKeys = trailing5Weeks();
  const wowFrom = wowKeys[0];

  const wowRows = await query<{
    week_key: string;
    chat_vol: string; avg_chat_iqs: string; csat_good: string; csat_total: string;
    parameters: any;
  }>(`
    SELECT
      TO_CHAR(date_trunc('week', COALESCE(c.closed_at, NOW())), 'YYYY-MM-DD') AS week_key,
      COUNT(c.id)::text                                                         AS chat_vol,
      AVG(s.iqs_score)::text                                                    AS avg_chat_iqs,
      COUNT(CASE WHEN c.csat_score = 5 THEN 1 END)::text                       AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) THEN 1 END)::text                AS csat_total,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL)           AS parameters
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE a.name = $1
      AND c.closed_at::date >= $2
    GROUP BY 1
  `, [agentName, wowFrom]);

  const wowCallRows = await query<{
    week_key: string; call_vol: string; avg_call_iqs: string;
  }>(`
    SELECT
      TO_CHAR(date_trunc('week', cr.called_at), 'YYYY-MM-DD') AS week_key,
      COUNT(cr.id)::text                                        AS call_vol,
      AVG(s.call_iqs_score)::text                               AS avg_call_iqs
    FROM call_recordings cr
    JOIN agents a ON a.id = cr.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
    WHERE a.name = $1
      AND cr.called_at::date >= $2
    GROUP BY 1
  `, [agentName, wowFrom]);

  // Index WoW rows by week key
  const wowByKey: Record<string, typeof wowRows[0]> = {};
  for (const r of wowRows) { if (r.week_key) wowByKey[r.week_key] = r; }
  const callByKey: Record<string, typeof wowCallRows[0]> = {};
  for (const r of wowCallRows) { if (r.week_key) callByKey[r.week_key] = r; }

  // Build WoW metrics arrays aligned to wowKeys
  const wowMetrics = {
    chats: {
      csat: wowKeys.map(k => {
        const r = wowByKey[k];
        return r ? pctOrNull(parseInt(r.csat_good ?? '0'), parseInt(r.csat_total ?? '0')) : null;
      }),
      iqs: wowKeys.map(k => {
        const r = wowByKey[k];
        return r?.avg_chat_iqs ? Math.round(parseFloat(r.avg_chat_iqs)) : null;
      }),
      volume: wowKeys.map(k => parseInt(wowByKey[k]?.chat_vol ?? '0')),
    },
    calls: {
      csat: wowKeys.map(() => null as number | null),
      iqs: wowKeys.map(k => {
        const r = callByKey[k];
        return r?.avg_call_iqs ? Math.round(parseFloat(r.avg_call_iqs)) : null;
      }),
      volume: wowKeys.map(k => parseInt(callByKey[k]?.call_vol ?? '0')),
    },
    emails: {
      csat: wowKeys.map(() => null as number | null),
      iqs: wowKeys.map(() => null as number | null),
      volume: wowKeys.map(() => 0),
    },
  };

  // ── WoW params (chat parameters per week) ──────────────────────────────────
  // Aggregate pass rates per parameter per week from the parameters JSONB array
  const wowParamMap: Record<string, Record<string, { yes: number; total: number }>> = {};
  for (const key of wowKeys) wowParamMap[key] = {};

  for (const r of wowRows) {
    const wk = r.week_key;
    if (!wk || !wowParamMap[wk] || !Array.isArray(r.parameters)) continue;
    for (const paramObj of r.parameters) {
      if (!paramObj) continue;
      for (const [rawKey, val] of Object.entries(paramObj as Record<string, any>)) {
        if (rawKey.startsWith('__')) continue;
        const pk = normalizeParamKey(rawKey);
        if (!PARAM_ORDER.includes(pk)) continue;
        if (!wowParamMap[wk][pk]) wowParamMap[wk][pk] = { yes: 0, total: 0 };
        const score = val?.score;
        if (score === true || score === 'Yes') { wowParamMap[wk][pk].yes++; wowParamMap[wk][pk].total++; }
        else if (score === false || score === 'No') { wowParamMap[wk][pk].total++; }
        // NA: skip (doesn't affect pass rate)
      }
    }
  }

  const CHAT_ACTIVE_PARAM_ORDER = [
    'Technical', 'AllQuestions', 'Expectation', 'DissatisfactionHandling', 'Contextual',
    'FollowUp', 'Sentences', 'Opening', 'Call', 'Empathy',
  ];

  const wowParams = {
    chats: CHAT_ACTIVE_PARAM_ORDER.map(pk => ({
      name: PARAM_NAMES[pk] ?? pk,
      vals: wowKeys.map(k => {
        const d = wowParamMap[k]?.[pk];
        return d && d.total > 0 ? Math.round((d.yes / d.total) * 100) : null;
      }),
    })),
    calls: [] as Array<{ name: string; vals: (number | null)[] }>,
  };

  return NextResponse.json({
    statCards,
    categories,
    wowWeeks: wowKeys.map(k => weekLabel(k)),
    wowMetrics,
    wowParams,
  });
}
