import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { PARAM_ORDER, PARAM_NAMES, calculateWeightedOverallIQS } from '@/lib/quality';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';

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

function normalizeParamKey(raw: string): string {
  return ALL_DB_KEY_TO_PASCAL[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1));
}

function extractPooledParamsFromRawArray(paramsArray: any[]): Record<string, { yes: number; total: number }> {
  const pooled: Record<string, { yes: number; total: number }> = {};
  if (!Array.isArray(paramsArray)) return pooled;
  for (const paramObj of paramsArray) {
    if (!paramObj) continue;
    const targetObj = paramObj.__agent_parameters || paramObj;
    for (const [rawKey, val] of Object.entries(targetObj as Record<string, any>)) {
      if (rawKey.startsWith('__')) continue;
      const pk = normalizeParamKey(rawKey);
      if (!PARAM_ORDER.includes(pk)) continue;
      if (!pooled[pk]) pooled[pk] = { yes: 0, total: 0 };
      const score = val?.score;
      if (score === true || score === 'Yes' || score === 1 || score === '1') {
        pooled[pk].yes++; pooled[pk].total++;
      } else if (score === 0.5 || score === 'Half') {
        pooled[pk].yes += 0.5; pooled[pk].total++;
      } else if (score === false || score === 'No' || score === 0 || score === '0') {
        pooled[pk].total++;
      }
    }
  }
  return pooled;
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
  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = await getUserByEmail(email).catch(() => null);
  const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
  const rawName = dbUser?.name || configUser?.agentName || email.split('@')[0];

  let matchedAgent: { id: number; name: string } | null = null;
  if (dbUser?.user_id) {
    const byUserId = await query<{ id: number; name: string }>(
      `SELECT id, name FROM agents WHERE user_id = $1 LIMIT 1`, [dbUser.user_id]
    );
    if (byUserId.length > 0) matchedAgent = byUserId[0];
  }
  if (!matchedAgent && rawName) {
    const byName = await query<{ id: number; name: string }>(
      `SELECT id, name FROM agents 
       WHERE LOWER(name) = LOWER($1) 
          OR LOWER($1) LIKE LOWER(name || ' %') 
          OR LOWER(name) LIKE LOWER($1 || ' %') 
       LIMIT 1`,
      [rawName.trim()]
    );
    if (byName.length > 0) matchedAgent = byName[0];
  }
  const agentName = matchedAgent?.name || rawName;
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
  const chatStatRows = await query<{
    total: string; with_iqs: string;
    csat_good: string; csat_total: string;
    parameters: any;
  }>(`
    SELECT
      COUNT(c.id)::text                                                AS total,
      COUNT(s.iqs_score)::text                                         AS with_iqs,
      COUNT(CASE WHEN c.csat_score = 5 THEN 1 END)::text              AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) THEN 1 END)::text       AS csat_total,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
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

  const chatPooledParams = extractPooledParamsFromRawArray(cs?.parameters);
  const chatIqsScore = calculateWeightedOverallIQS(chatPooledParams, 'human');

  const statCards = {
    chats: {
      volume: parseInt(cs?.total ?? '0'),
      iqs:    chatIqsScore,
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
    avg_res: string; count: string; parameters: any;
  }>(`
    SELECT
      COALESCE(c.tags->>'disposition', 'Other')          AS disposition,
      COALESCE(c.tags->>'sub_disposition', '')            AS sub_disposition,
      AVG(c.resolution_seconds)::text                     AS avg_res,
      COUNT(c.id)::text                                   AS count,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
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
    params: Record<string, { yes: number; total: number }>; resVals: number[]; count: number;
    subs: Record<string, { params: Record<string, { yes: number; total: number }>; resVals: number[]; count: number }>;
  }> = {};

  for (const r of catRows) {
    const d = r.disposition || 'Other';
    if (!dispMap[d]) dispMap[d] = { params: {}, resVals: [], count: 0, subs: {} };
    const res = r.avg_res ? parseFloat(r.avg_res) : null;
    const cnt = parseInt(r.count ?? '0');
    dispMap[d].count += cnt;
    if (res != null) dispMap[d].resVals.push(res);

    const rowParams = extractPooledParamsFromRawArray(r.parameters);
    for (const [pk, pval] of Object.entries(rowParams)) {
      if (!dispMap[d].params[pk]) dispMap[d].params[pk] = { yes: 0, total: 0 };
      dispMap[d].params[pk].yes += pval.yes;
      dispMap[d].params[pk].total += pval.total;
    }

    const sub = r.sub_disposition;
    if (sub) {
      if (!dispMap[d].subs[sub]) dispMap[d].subs[sub] = { params: {}, resVals: [], count: 0 };
      dispMap[d].subs[sub].count += cnt;
      if (res != null) dispMap[d].subs[sub].resVals.push(res);
      for (const [pk, pval] of Object.entries(rowParams)) {
        if (!dispMap[d].subs[sub].params[pk]) dispMap[d].subs[sub].params[pk] = { yes: 0, total: 0 };
        dispMap[d].subs[sub].params[pk].yes += pval.yes;
        dispMap[d].subs[sub].params[pk].total += pval.total;
      }
    }
  }

  const categories = Object.entries(dispMap)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([disp, d]) => ({
      disposition: disp,
      iqsChats: calculateWeightedOverallIQS(d.params, 'human'),
      resolutionSecs: avgOrNull(d.resVals),
      children: Object.entries(d.subs)
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([name, s]) => ({
          name,
          iqsChats: calculateWeightedOverallIQS(s.params, 'human'),
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
        return calculateWeightedOverallIQS(wowParamMap[k], 'human');
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
        else if (score === 0.5 || score === 'Half') { wowParamMap[wk][pk].yes += 0.5; wowParamMap[wk][pk].total++; }
        else if (score === false || score === 'No') { wowParamMap[wk][pk].total++; }
        // NA: skip (doesn't affect pass rate)
      }
    }
  }

  // Show every weighted v4 parameter, in rubric order (was a hardcoded v3 list).
  const CHAT_ACTIVE_PARAM_ORDER = PARAM_ORDER;

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
