import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { log, withLogging } from '@/lib/log';

const ROUTE = 'cx/qa/analytics';

// ── helpers ────────────────────────────────────────────────────────────────

function periodDates(params: URLSearchParams): { from: Date; to: Date } {
  const p = params.get('period');
  const now = new Date();
  if (p === 'custom') {
    const from = params.get('from');
    const to   = params.get('to');
    if (!from || !to) throw new Error('from and to required for custom period');
    // Interpret dates as IST (UTC+05:30) so "June 2" means June 2 00:00 IST, not UTC midnight
    return { from: new Date(from + 'T00:00:00+05:30'), to: new Date(to + 'T23:59:59+05:30') };
  }
  const days = p === '7' ? 7 : 30;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from, to: now };
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10; // one decimal
}

function avgOrNull(sum: number, count: number): number | null {
  if (!count) return null;
  return Math.round((sum / count) * 10) / 10;
}

// ── row type returned by the aggregation query ────────────────────────────

// Agent names treated as bot/AI-handled
const BOT_AGENT_NAMES = ['Robylon', 'Robylon AI', 'Myra'];

interface AggRow {
  disposition:        string;
  sub_disposition:    string | null;
  is_bot:             boolean;   // agent is a known bot agent
  has_call:           boolean;   // call_iqs_score IS NOT NULL
  total:              string;
  csat_rated:         string;
  csat_good:          string;
  sum_iqs:            string | null;
  iqs_count:          string;
  sum_call_iqs:       string | null;
  call_iqs_count:     string;
  sum_resolution:     string | null;
  resolution_count:   string;
}

// ── pending counts ────────────────────────────────────────────────────────

interface PendingRow {
  channel: 'chat' | 'call';
  cnt: string;
}

// ── GET handler ───────────────────────────────────────────────────────────

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const t0 = Date.now();
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  if (!['quality', 'admin', 'tl', 'agent'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  // Resolve date range
  let from: Date, to: Date;
  try {
    ({ from, to } = periodDates(searchParams));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Resolve dispositions for this QA
  const config = await readConfig();
  let dispositions: string[];

  if (role === 'admin' || role === 'tl' || role === 'agent') {
    // Admin can pass explicit dispositions or see everything
    const explicit = searchParams.getAll('disposition');
    if (explicit.length) {
      dispositions = explicit;
    } else {
      // All dispositions
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

  log.info(ROUTE, 'dispositions', { role, email, dispositionCount: dispositions.length, sample: dispositions.slice(0, 3) });

  if (!dispositions.length) {
    return NextResponse.json({
      pending: { total: 0, chats: 0, calls: 0, emails: 0 },
      iqs: { chat: null, call: null, email: null },
      byDisposition: [],
    });
  }

  const fromISO = from.toISOString();
  const toISO   = to.toISOString();

  // Diagnostic: count total convos in range (any disposition, with or without tags)
  const diagRows = await query<{ total_any: string; with_dispo: string; with_closed_at: string }>(
    `SELECT
       COUNT(*)::text AS total_any,
       COUNT(*) FILTER (WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != '')::text AS with_dispo,
       COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::text AS with_closed_at
     FROM conversations
     WHERE closed_at >= $1 AND closed_at <= $2`,
    [fromISO, toISO]
  );
  log.info(ROUTE, 'diag', {
    fromISO, toISO,
    totalAny:       diagRows[0]?.total_any,
    withDispo:      diagRows[0]?.with_dispo,
    withClosedAt:   diagRows[0]?.with_closed_at,
  });

  // ── 1. Pending review counts (IQS < 80 and not yet reviewed) ─────────────
  const pendingRows = await query<PendingRow>(
    `SELECT
       CASE WHEN i.call_iqs_score IS NOT NULL THEN 'call' ELSE 'chat' END AS channel,
       COUNT(*)::text AS cnt
     FROM iqs_scores i
     JOIN conversations c ON c.id = i.chat_id
     WHERE c.tags->>'disposition' = ANY($1)
       AND c.closed_at >= $2 AND c.closed_at <= $3
       AND (
         (i.call_iqs_score IS NULL AND i.iqs_score < 80)
         OR (i.call_iqs_score IS NOT NULL AND i.call_iqs_score < 80)
       )
       AND i.reviewed_by IS NULL
     GROUP BY 1`,
    [dispositions, fromISO, toISO]
  );

  const pendingChats = parseInt(pendingRows.find(r => r.channel === 'chat')?.cnt ?? '0');
  const pendingCalls = parseInt(pendingRows.find(r => r.channel === 'call')?.cnt ?? '0');

  // ── 2. Overall IQS by channel (for ring cards) ───────────────────────────
  const iqsOverview = await query<{ avg_iqs: string | null; avg_call_iqs: string | null }>(
    `SELECT
       AVG(i.iqs_score)      FILTER (WHERE i.iqs_score      IS NOT NULL) AS avg_iqs,
       AVG(i.call_iqs_score) FILTER (WHERE i.call_iqs_score IS NOT NULL) AS avg_call_iqs
     FROM iqs_scores i
     JOIN conversations c ON c.id = i.chat_id
     WHERE c.tags->>'disposition' = ANY($1)
       AND c.closed_at >= $2 AND c.closed_at <= $3`,
    [dispositions, fromISO, toISO]
  );

  const chatIQS = iqsOverview[0]?.avg_iqs      != null ? Math.round(parseFloat(iqsOverview[0].avg_iqs))      : null;
  const callIQS = iqsOverview[0]?.avg_call_iqs != null ? Math.round(parseFloat(iqsOverview[0].avg_call_iqs)) : null;

  // ── 3. Per-disposition aggregation ───────────────────────────────────────
  const aggRows = await query<AggRow>(
    `SELECT
       COALESCE(c.tags->>'disposition', '')                AS disposition,
       c.tags->>'sub_disposition'                          AS sub_disposition,
       (a.name = ANY($4))                                  AS is_bot,
       (i.call_iqs_score IS NOT NULL)                      AS has_call,
       COUNT(*)::text                                      AS total,
       COUNT(*) FILTER (WHERE c.csat_score IS NOT NULL)::text AS csat_rated,
       COUNT(*) FILTER (WHERE c.csat_score = 5)::text         AS csat_good,
       SUM(i.iqs_score)      FILTER (WHERE i.iqs_score      IS NOT NULL)::text AS sum_iqs,
       COUNT(i.iqs_score)    FILTER (WHERE i.iqs_score      IS NOT NULL)::text AS iqs_count,
       SUM(i.call_iqs_score) FILTER (WHERE i.call_iqs_score IS NOT NULL)::text AS sum_call_iqs,
       COUNT(i.call_iqs_score) FILTER (WHERE i.call_iqs_score IS NOT NULL)::text AS call_iqs_count,
       SUM(c.resolution_seconds)   FILTER (WHERE c.resolution_seconds IS NOT NULL)::text AS sum_resolution,
       COUNT(c.resolution_seconds) FILTER (WHERE c.resolution_seconds IS NOT NULL)::text AS resolution_count
     FROM conversations c
     LEFT JOIN iqs_scores i ON c.id = i.chat_id
     LEFT JOIN agents a ON a.id = c.agent_id
     WHERE c.tags->>'disposition' = ANY($1)
       AND c.closed_at >= $2 AND c.closed_at <= $3
     GROUP BY 1, 2, 3, 4
     ORDER BY 1, 2`,
    [dispositions, fromISO, toISO, BOT_AGENT_NAMES]
  );

  // ── 4. Grand total (for pct calculation) ─────────────────────────────────
  const grandTotal = aggRows.reduce((s, r) => s + parseInt(r.total), 0);

  // ── 5. Build tree structure ───────────────────────────────────────────────
  // Group rows by disposition, then sub_disposition
  const dispoMap = new Map<string, AggRow[]>();
  for (const row of aggRows) {
    const key = row.disposition;
    if (!dispoMap.has(key)) dispoMap.set(key, []);
    dispoMap.get(key)!.push(row);
  }

  const byDisposition = Array.from(dispoMap.entries()).map(([dispo, rows]) => {
    // Aggregate across all conv_types for this L1
    const totalCount  = rows.reduce((s, r) => s + parseInt(r.total), 0);
    const botCount    = rows.filter(r => r.is_bot).reduce((s, r) => s + parseInt(r.total), 0);
    const botCsatRated = rows.filter(r => r.is_bot).reduce((s, r) => s + parseInt(r.csat_rated), 0);
    const botCsatGood  = rows.filter(r => r.is_bot).reduce((s, r) => s + parseInt(r.csat_good), 0);

    // CSAT by channel
    const humanRows = rows.filter(r => !r.is_bot);
    const chatCsatRated = humanRows.reduce((s, r) => s + parseInt(r.csat_rated), 0);
    const chatCsatGood  = humanRows.reduce((s, r) => s + parseInt(r.csat_good), 0);
    // "Calls" = rows that had a call interaction (call_iqs_score present)
    const callRows = rows.filter(r => r.has_call);
    const callCsatRated = callRows.reduce((s, r) => s + parseInt(r.csat_rated), 0);
    const callCsatGood  = callRows.reduce((s, r) => s + parseInt(r.csat_good), 0);

    // IQS by channel
    const iqsSum   = rows.reduce((s, r) => s + (r.sum_iqs      ? parseFloat(r.sum_iqs)      : 0), 0);
    const iqsCnt   = rows.reduce((s, r) => s + parseInt(r.iqs_count), 0);
    const callIqsSum = rows.reduce((s, r) => s + (r.sum_call_iqs ? parseFloat(r.sum_call_iqs) : 0), 0);
    const callIqsCnt = rows.reduce((s, r) => s + parseInt(r.call_iqs_count), 0);

    // Resolution time
    const resSum = rows.reduce((s, r) => s + (r.sum_resolution ? parseFloat(r.sum_resolution) : 0), 0);
    const resCnt = rows.reduce((s, r) => s + parseInt(r.resolution_count), 0);

    // Sub-dispositions
    const subMap = new Map<string, AggRow[]>();
    for (const row of rows) {
      const key = row.sub_disposition?.trim() || '(none)';
      if (!subMap.has(key)) subMap.set(key, []);
      subMap.get(key)!.push(row);
    }

    const children = Array.from(subMap.entries()).map(([sub, sRows]) => {
      const st  = sRows.reduce((s, r) => s + parseInt(r.total), 0);
      const sbc = sRows.filter(r => r.is_bot);
      const sbr = sbc.reduce((s, r) => s + parseInt(r.csat_rated), 0);
      const sbg = sbc.reduce((s, r) => s + parseInt(r.csat_good), 0);
      const sHuman = sRows.filter(r => !r.is_bot);
      const shcr = sHuman.reduce((s, r) => s + parseInt(r.csat_rated), 0);
      const shcg = sHuman.reduce((s, r) => s + parseInt(r.csat_good), 0);
      const sCall = sRows.filter(r => r.has_call);
      const scallr = sCall.reduce((s, r) => s + parseInt(r.csat_rated), 0);
      const scallg = sCall.reduce((s, r) => s + parseInt(r.csat_good), 0);
      const siqs   = sRows.reduce((s, r) => s + (r.sum_iqs ? parseFloat(r.sum_iqs) : 0), 0);
      const siqsc  = sRows.reduce((s, r) => s + parseInt(r.iqs_count), 0);
      const sciqs  = sRows.reduce((s, r) => s + (r.sum_call_iqs ? parseFloat(r.sum_call_iqs) : 0), 0);
      const sciqsc = sRows.reduce((s, r) => s + parseInt(r.call_iqs_count), 0);
      const sres   = sRows.reduce((s, r) => s + (r.sum_resolution ? parseFloat(r.sum_resolution) : 0), 0);
      const sresc  = sRows.reduce((s, r) => s + parseInt(r.resolution_count), 0);
      const sbotC  = sbc.reduce((s, r) => s + parseInt(r.total), 0);

      return {
        subDisposition: sub,
        count:          st,
        pct:            pct(st, grandTotal),
        csatChat:       pct(shcg, shcr),
        csatCall:       pct(scallg, scallr),
        csatEmail:      null,
        aiChatCsat:     pct(sbg, sbr),
        pctDeflected:   pct(sbotC, st),
        iqsChat:        avgOrNull(siqs, siqsc),
        iqsCall:        avgOrNull(sciqs, sciqsc),
        iqsEmail:       null,
        resolutionSecs: avgOrNull(sres, sresc),
      };
    });
    // Drop the "(none)" bucket if it is the only sub-dispo (to avoid redundant expand button),
    // but keep it if there are other sub-dispositions so the breakdown count matches the parent count.
    const filteredChildren = (children.length === 1 && children[0].subDisposition === '(none)')
      ? []
      : children;

    return {
      disposition:    dispo,
      count:          totalCount,
      pct:            pct(totalCount, grandTotal),
      csatChat:       pct(chatCsatGood, chatCsatRated),
      csatCall:       pct(callCsatGood, callCsatRated),
      csatEmail:      null,
      aiChatCsat:     pct(botCsatGood, botCsatRated),
      pctDeflected:   pct(botCount, totalCount),
      iqsChat:        avgOrNull(iqsSum, iqsCnt),
      iqsCall:        avgOrNull(callIqsSum, callIqsCnt),
      iqsEmail:       null,
      resolutionSecs: avgOrNull(resSum, resCnt),
      children: filteredChildren,
    };
  });

  log.info(ROUTE, 'result', {
    period:           searchParams.get('period') ?? '30',
    fromRaw:          searchParams.get('from'),
    toRaw:            searchParams.get('to'),
    fromISO,
    toISO,
    dispositionCount: dispositions.length,
    pendingTotal:     pendingChats + pendingCalls,
    pendingChats,
    pendingCalls,
    byDispositionCount: byDisposition.length,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json({
    pending: {
      total:  pendingChats + pendingCalls,
      chats:  pendingChats,
      calls:  pendingCalls,
      emails: 0,
    },
    iqs: {
      chat:  chatIQS,
      call:  callIQS,
      email: null,
    },
    byDisposition,
  });
});
