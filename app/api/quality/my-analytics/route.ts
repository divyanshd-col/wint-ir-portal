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
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !['agent', 'admin', 'tl', 'quality'].includes(session.user.role || '')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '30';
    const customFrom = searchParams.get('from') || '';
    const customTo = searchParams.get('to') || '';
    const requestedAgent = searchParams.get('agent') || '';
    const requestedEmail = searchParams.get('email') || '';

    // Resolve agent name from config
    const config = await readConfig();
    const email = requestedEmail || session.user.email || '';
    const { getUserByEmail } = await import('@/lib/users');
    const dbUser = await getUserByEmail(email).catch(() => null);
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    const rawName = requestedAgent || dbUser?.name || configUser?.agentName || email.split('@')[0];

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
    const agentName = requestedAgent || matchedAgent?.name || rawName;
    if (!agentName) {
      return NextResponse.json({ error: 'Agent not configured' }, { status: 404 });
    }

    // Compute period date range
    const today = new Date().toISOString().slice(0, 10);
    let dateFrom: string;
    let dateTo: string = today;

    if (period === 'custom' && customFrom && customTo) {
      dateFrom = customFrom;
      dateTo = customTo;
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
      solvable_csat_pct?: number | null;
      unsolvable_csat_pct?: number | null;
      parameters: any;
    }>(`
    SELECT
      COUNT(c.id)::text                                                AS total,
      COUNT(s.iqs_score) FILTER (WHERE c.tags->>'disposition' IS NULL OR c.tags->>'disposition' NOT ILIKE '%junk%')::text AS with_iqs,
      COUNT(CASE WHEN c.csat_score = 5 OR c.csat_label = 'good' THEN 1 END)::text              AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) OR c.csat_label IS NOT NULL THEN 1 END)::text   AS csat_total,
      ROUND(COUNT(CASE WHEN c.csat_bifurcation = 'solvable' AND (c.csat_label = 'good' OR c.csat_score = 5) THEN 1 END)::numeric
            / NULLIF(COUNT(CASE WHEN c.csat_bifurcation = 'solvable' AND (c.csat_label IS NOT NULL OR c.csat_score IN (1,3,5)) THEN 1 END),0)*100,1)::float AS solvable_csat_pct,
      ROUND(COUNT(CASE WHEN c.csat_bifurcation = 'unsolvable' AND (c.bifurcated_csat_label = 'good' OR (c.bifurcated_csat_label IS NULL AND (c.csat_label = 'good' OR c.csat_score = 5))) THEN 1 END)::numeric
            / NULLIF(COUNT(CASE WHEN c.csat_bifurcation = 'unsolvable' AND (c.csat_label IS NOT NULL OR c.csat_score IN (1,3,5)) THEN 1 END),0)*100,1)::float AS unsolvable_csat_pct,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL AND (c.tags->>'disposition' IS NULL OR c.tags->>'disposition' NOT ILIKE '%junk%')) AS parameters
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
      AVG(s.call_iqs_score) FILTER (
        WHERE (cr.call_disposition IS NULL OR cr.call_disposition NOT ILIKE '%junk%')
          AND (cr.call_sub_disposition IS NULL OR cr.call_sub_disposition NOT ILIKE '%junk%')
          AND (c.tags->>'disposition' IS NULL OR c.tags->>'disposition' NOT ILIKE '%junk%')
      )::text                                                           AS avg_call_iqs,
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

    // Email stats
    const emailStatRows = await query<{
      email_vol: string; avg_email_iqs: string; csat_good: string; csat_total: string;
    }>(`
    SELECT
      COUNT(e.id)::text                                                 AS email_vol,
      AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE c.intent_l1 IS NULL OR c.intent_l1 NOT ILIKE '%junk%')::text AS avg_email_iqs,
      COUNT(CASE WHEN e.csat_score = 5 THEN 1 END)::text               AS csat_good,
      COUNT(CASE WHEN e.csat_score IN (1,3,5) THEN 1 END)::text        AS csat_total
    FROM email_reply_evaluations e
    LEFT JOIN email_conversations c ON c.id = e.ticket_id
    WHERE TRIM(e.agent_name) ILIKE $1
      AND e.sent_at::date >= $2
      AND e.sent_at::date <= $3
      AND (e.evaluation_status = 'Completed' OR e.quality_score IS NOT NULL)
  `, [agentName, dateFrom, dateTo]).catch(err => {
      console.warn('[my-analytics] emailStatRows error:', err);
      return [];
    });

    const cs = chatStatRows[0];
    const ks = callStatRows[0];
    const es = emailStatRows[0];

    const chatPooledParams = extractPooledParamsFromRawArray(cs?.parameters);
    const chatIqsScore = calculateWeightedOverallIQS(chatPooledParams, 'human');

    const emailVol = parseInt(es?.email_vol ?? '0');
    const emailIqs = es?.avg_email_iqs ? Math.round(parseFloat(es.avg_email_iqs)) : null;
    const emailCsat = pctOrNull(parseInt(es?.csat_good ?? '0'), parseInt(es?.csat_total ?? '0'));

    const statCards = {
      chats: {
        volume: parseInt(cs?.total ?? '0'),
        iqs: chatIqsScore,
        csat: pctOrNull(parseInt(cs?.csat_good ?? '0'), parseInt(cs?.csat_total ?? '0')),
        solvable_csat_pct: cs?.solvable_csat_pct != null ? Number(cs.solvable_csat_pct) : null,
        unsolvable_csat_pct: cs?.unsolvable_csat_pct != null ? Number(cs.unsolvable_csat_pct) : null,
        solvable_csat: cs?.solvable_csat_pct != null ? Number(cs.solvable_csat_pct) : null,
        unsolvable_csat: cs?.unsolvable_csat_pct != null ? Number(cs.unsolvable_csat_pct) : null,
      },
      calls: {
        volume: parseInt(ks?.call_vol ?? '0'),
        iqs: ks?.avg_call_iqs ? Math.round(parseFloat(ks.avg_call_iqs)) : null,
        csat: pctOrNull(parseInt(ks?.csat_good ?? '0'), parseInt(ks?.csat_total ?? '0')),
      },
      emails: {
        volume: emailVol,
        iqs: emailIqs,
        csat: emailCsat,
      },
    };

    // ── Category tree (period-scoped, chats + calls + emails IQS & CSAT) ─────────
    const catRows = await query<{
      disposition: string; sub_disposition: string;
      avg_res: string; count: string; csat_good: string; csat_total: string; parameters: any;
    }>(`
    SELECT
      COALESCE(c.tags->>'disposition', 'Other')          AS disposition,
      COALESCE(c.tags->>'sub_disposition', '')            AS sub_disposition,
      AVG(c.resolution_seconds)::text                     AS avg_res,
      COUNT(c.id)::text                                   AS count,
      COUNT(CASE WHEN c.csat_label = 'good' OR c.csat_score = 5 THEN 1 END)::text AS csat_good,
      COUNT(CASE WHEN c.csat_label IS NOT NULL OR c.csat_score IN (1,3,5) THEN 1 END)::text AS csat_total,
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

    const callCatRows = await query<{
      disposition: string; sub_disposition: string;
      avg_iqs: string; count: string; csat_good: string; csat_total: string;
    }>(`
      SELECT
        COALESCE(cr.call_disposition, c.tags->>'disposition', 'Other') AS disposition,
        COALESCE(cr.call_sub_disposition, c.tags->>'sub_disposition', '') AS sub_disposition,
        AVG(s.call_iqs_score)::text AS avg_iqs,
        COUNT(cr.id)::text AS count,
        COUNT(CASE WHEN c.csat_label = 'good' OR c.csat_score = 5 THEN 1 END)::text AS csat_good,
        COUNT(CASE WHEN c.csat_label IS NOT NULL OR c.csat_score IN (1,3,5) THEN 1 END)::text AS csat_total
      FROM call_recordings cr
      JOIN agents a ON a.id = cr.agent_id
      LEFT JOIN conversations c ON c.id = cr.chat_id
      LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
      WHERE a.name = $1
        AND cr.called_at::date >= $2
        AND cr.called_at::date <= $3
        AND s.call_iqs_score IS NOT NULL
      GROUP BY 1, 2
    `, [agentName, dateFrom, dateTo]).catch(() => []);

    const emailCatRows = await query<{
      disposition: string; avg_iqs: string; count: string; csat_good: string; csat_total: string;
    }>(`
      SELECT
        COALESCE(NULLIF(TRIM(c.intent_l1), ''), 'Other') AS disposition,
        AVG(COALESCE(e.qa_override_score, e.quality_score))::text AS avg_iqs,
        COUNT(e.id)::text AS count,
        COUNT(CASE WHEN e.csat_score = 5 THEN 1 END)::text AS csat_good,
        COUNT(CASE WHEN e.csat_score IN (1,3,5) THEN 1 END)::text AS csat_total
      FROM email_reply_evaluations e
      LEFT JOIN email_conversations c ON c.id = e.ticket_id
      WHERE TRIM(e.agent_name) ILIKE $1
        AND e.sent_at::date >= $2
        AND e.sent_at::date <= $3
        AND (e.evaluation_status = 'Completed' OR e.quality_score IS NOT NULL)
        AND (c.intent_l1 IS NULL OR c.intent_l1 NOT ILIKE '%junk%')
      GROUP BY 1
    `, [agentName, dateFrom, dateTo]).catch(() => []);

    // Build disposition tree
    interface SubDispAccum {
      params: Record<string, { yes: number; total: number }>;
      resVals: number[];
      count: number;
      callIqsVals: number[];
      emailIqsVals: number[];
      chatCsatGood: number; chatCsatTotal: number;
      callCsatGood: number; callCsatTotal: number;
      emailCsatGood: number; emailCsatTotal: number;
    }
    interface DispAccum {
      params: Record<string, { yes: number; total: number }>;
      resVals: number[];
      count: number;
      callIqsVals: number[];
      emailIqsVals: number[];
      chatCsatGood: number; chatCsatTotal: number;
      callCsatGood: number; callCsatTotal: number;
      emailCsatGood: number; emailCsatTotal: number;
      subs: Record<string, SubDispAccum>;
    }

    const dispMap: Record<string, DispAccum> = {};

    function getOrCreateDisp(d: string): DispAccum {
      if (!dispMap[d]) {
        dispMap[d] = {
          params: {}, resVals: [], count: 0, callIqsVals: [], emailIqsVals: [],
          chatCsatGood: 0, chatCsatTotal: 0, callCsatGood: 0, callCsatTotal: 0, emailCsatGood: 0, emailCsatTotal: 0,
          subs: {},
        };
      }
      return dispMap[d];
    }

    function getOrCreateSub(parent: DispAccum, sub: string): SubDispAccum {
      if (!parent.subs[sub]) {
        parent.subs[sub] = {
          params: {}, resVals: [], count: 0, callIqsVals: [], emailIqsVals: [],
          chatCsatGood: 0, chatCsatTotal: 0, callCsatGood: 0, callCsatTotal: 0, emailCsatGood: 0, emailCsatTotal: 0,
        };
      }
      return parent.subs[sub];
    }

    for (const r of catRows) {
      const d = r.disposition || 'Other';
      const item = getOrCreateDisp(d);
      const res = r.avg_res ? parseFloat(r.avg_res) : null;
      const cnt = parseInt(r.count ?? '0');
      const cg = parseInt(r.csat_good ?? '0');
      const ct = parseInt(r.csat_total ?? '0');
      item.count += cnt;
      item.chatCsatGood += cg;
      item.chatCsatTotal += ct;
      if (res != null) item.resVals.push(res);

      const rowParams = extractPooledParamsFromRawArray(r.parameters);
      for (const [pk, pval] of Object.entries(rowParams)) {
        if (!item.params[pk]) item.params[pk] = { yes: 0, total: 0 };
        item.params[pk].yes += pval.yes;
        item.params[pk].total += pval.total;
      }

      const sub = r.sub_disposition;
      if (sub) {
        const subItem = getOrCreateSub(item, sub);
        subItem.count += cnt;
        subItem.chatCsatGood += cg;
        subItem.chatCsatTotal += ct;
        if (res != null) subItem.resVals.push(res);
        for (const [pk, pval] of Object.entries(rowParams)) {
          if (!subItem.params[pk]) subItem.params[pk] = { yes: 0, total: 0 };
          subItem.params[pk].yes += pval.yes;
          subItem.params[pk].total += pval.total;
        }
      }
    }

    for (const r of callCatRows) {
      const d = r.disposition || 'Other';
      const item = getOrCreateDisp(d);
      const iqs = r.avg_iqs ? parseFloat(r.avg_iqs) : null;
      const cnt = parseInt(r.count ?? '0');
      const cg = parseInt(r.csat_good ?? '0');
      const ct = parseInt(r.csat_total ?? '0');
      item.count += cnt;
      item.callCsatGood += cg;
      item.callCsatTotal += ct;
      if (iqs != null) item.callIqsVals.push(iqs);

      const sub = r.sub_disposition;
      if (sub) {
        const subItem = getOrCreateSub(item, sub);
        subItem.count += cnt;
        subItem.callCsatGood += cg;
        subItem.callCsatTotal += ct;
        if (iqs != null) subItem.callIqsVals.push(iqs);
      }
    }

    for (const r of emailCatRows) {
      const d = r.disposition || 'Other';
      const item = getOrCreateDisp(d);
      const iqs = r.avg_iqs ? parseFloat(r.avg_iqs) : null;
      const cnt = parseInt(r.count ?? '0');
      const cg = parseInt(r.csat_good ?? '0');
      const ct = parseInt(r.csat_total ?? '0');
      item.count += cnt;
      item.emailCsatGood += cg;
      item.emailCsatTotal += ct;
      if (iqs != null) item.emailIqsVals.push(iqs);
    }

    const csatPct = (good: number, total: number): number | null =>
      total > 0 ? Math.round((good / total) * 1000) / 10 : null;

    const categories = Object.entries(dispMap)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([disp, d]) => ({
        disposition: disp,
        iqsChats: calculateWeightedOverallIQS(d.params, 'human'),
        iqsCalls: avgOrNull(d.callIqsVals),
        iqsEmails: avgOrNull(d.emailIqsVals),
        csatChats: csatPct(d.chatCsatGood, d.chatCsatTotal),
        csatCalls: csatPct(d.callCsatGood, d.callCsatTotal),
        csatEmails: csatPct(d.emailCsatGood, d.emailCsatTotal),
        resolutionSecs: avgOrNull(d.resVals),
        children: Object.entries(d.subs)
          .sort(([, a], [, b]) => b.count - a.count)
          .map(([name, s]) => ({
            name,
            iqsChats: calculateWeightedOverallIQS(s.params, 'human'),
            iqsCalls: avgOrNull(s.callIqsVals),
            iqsEmails: avgOrNull(s.emailIqsVals),
            csatChats: csatPct(s.chatCsatGood, s.chatCsatTotal),
            csatCalls: csatPct(s.callCsatGood, s.callCsatTotal),
            csatEmails: csatPct(s.emailCsatGood, s.emailCsatTotal),
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
      AVG(s.iqs_score) FILTER (WHERE c.tags->>'disposition' IS NULL OR c.tags->>'disposition' NOT ILIKE '%junk%')::text AS avg_chat_iqs,
      COUNT(CASE WHEN c.csat_score = 5 THEN 1 END)::text                       AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) THEN 1 END)::text                AS csat_total,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL AND (c.tags->>'disposition' IS NULL OR c.tags->>'disposition' NOT ILIKE '%junk%')) AS parameters
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
      AVG(s.call_iqs_score) FILTER (
        WHERE (cr.call_disposition IS NULL OR cr.call_disposition NOT ILIKE '%junk%')
          AND (cr.call_sub_disposition IS NULL OR cr.call_sub_disposition NOT ILIKE '%junk%')
      )::text                                                   AS avg_call_iqs
    FROM call_recordings cr
    JOIN agents a ON a.id = cr.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
    WHERE a.name = $1
      AND cr.called_at::date >= $2
    GROUP BY 1
  `, [agentName, wowFrom]);

    const wowEmailRows = await query<{
      week_key: string; email_vol: string; avg_email_iqs: string; csat_good: string; csat_total: string;
    }>(`
    SELECT
      TO_CHAR(date_trunc('week', e.sent_at), 'YYYY-MM-DD') AS week_key,
      COUNT(e.id)::text                                     AS email_vol,
      AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE c.intent_l1 IS NULL OR c.intent_l1 NOT ILIKE '%junk%')::text AS avg_email_iqs,
      COUNT(CASE WHEN e.csat_score = 5 THEN 1 END)::text                       AS csat_good,
      COUNT(CASE WHEN e.csat_score IN (1,3,5) THEN 1 END)::text                AS csat_total
    FROM email_reply_evaluations e
    LEFT JOIN email_conversations c ON c.id = e.ticket_id
    WHERE TRIM(e.agent_name) ILIKE $1
      AND e.sent_at::date >= $2
      AND (e.evaluation_status = 'Completed' OR e.quality_score IS NOT NULL)
    GROUP BY 1
  `, [agentName, wowFrom]).catch(() => []);

    // Index WoW rows by week key
    const wowByKey: Record<string, typeof wowRows[0]> = {};
    for (const r of wowRows) { if (r.week_key) wowByKey[r.week_key] = r; }
    const callByKey: Record<string, typeof wowCallRows[0]> = {};
    for (const r of wowCallRows) { if (r.week_key) callByKey[r.week_key] = r; }
    const emailByKey: Record<string, typeof wowEmailRows[0]> = {};
    for (const r of wowEmailRows) { if (r.week_key) emailByKey[r.week_key] = r; }

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
        csat: wowKeys.map(k => {
          const r = emailByKey[k];
          return r ? pctOrNull(parseInt(r.csat_good ?? '0'), parseInt(r.csat_total ?? '0')) : null;
        }),
        iqs: wowKeys.map(k => {
          const r = emailByKey[k];
          return r?.avg_email_iqs ? Math.round(parseFloat(r.avg_email_iqs)) : null;
        }),
        volume: wowKeys.map(k => parseInt(emailByKey[k]?.email_vol ?? '0')),
      },
    };

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
      emails: [] as Array<{ name: string; vals: (number | null)[] }>,
    };

    return NextResponse.json({
      statCards,
      categories,
      wowWeeks: wowKeys.map(k => weekLabel(k)),
      wowMetrics,
      wowParams,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('Error in /api/quality/my-analytics:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load analytics data' },
      { status: 500 }
    );
  }
}
