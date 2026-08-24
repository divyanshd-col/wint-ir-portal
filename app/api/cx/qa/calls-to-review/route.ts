import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { log, withLogging } from '@/lib/log';

const ROUTE = 'cx/qa/calls-to-review';

export interface CallToReviewRow {
  callId:                 string;
  chatId:                 string | null;
  agentName:              string;
  iqsScore:               number | null;
  verdict:                string;
  calledAt:               string;
  disposition:            string;
  subDisposition:         string | null;
  durationSeconds:        number | null;
  language:               string | null;
  interruptionCount:      number;
  deadAirCount:           number;
  reviewedBy:             string | null;
  reviewedAt:             string | null;
  reviewNote:             string | null;
  status:                 string;
  gates:                  any;
  iqsScores:              any;
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const { session, response } = await requireRole(['quality', 'admin']);
  if (response) return response;
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  const { searchParams } = new URL(req.url);
  log.info(ROUTE, 'params', { raw: req.url.split('?')[1] ?? '' });

  // Resolve dispositions — admin sees ALL dispositions (unscoped), QA sees assigned (except Manorathi sees all)
  const config = await readConfig();
  let dispositions: string[] = [];
  const map = config.qaDispositionMap ?? [];
  const qaEntry = map.find(e => e.email.toLowerCase() === email.toLowerCase());

  const configUser = config.users.find((u: any) => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
  const userDisps = qaEntry?.dispositions ?? configUser?.assignedDispositions;

  if (role === 'quality') {
    dispositions = userDisps ?? [];
  } else if (role === 'admin') {
    const rows = await query<{ d: string }>(
      `SELECT DISTINCT call_disposition AS d FROM call_recordings WHERE call_disposition IS NOT NULL AND call_disposition != ''`
    );
    dispositions = rows.map(r => r.d);
  } else {
    return NextResponse.json({ calls: [], total: 0 });
  }

  const explicit = searchParams.getAll('disposition');
  if (explicit.length) {
    dispositions = explicit.filter(d => dispositions.includes(d));
  }

  if (!dispositions.length) {
    log.warn(ROUTE, 'no dispositions assigned to QA', { email, role });
    return NextResponse.json({ calls: [], total: 0 });
  }

  // Reviewed vs pending mode
  const reviewedMode = searchParams.get('reviewed') === 'true';

  // Optional narrowing by one or more dispositions within the QA's set
  const dispositionFilters = searchParams.getAll('disposition_filter').filter(d => dispositions.includes(d));
  const effectiveDispositions = dispositionFilters.length ? dispositionFilters : dispositions;

  const callId = searchParams.get('call_id');
  const hasCallId = Boolean(callId && callId.trim());

  // Build dynamic WHERE clauses
  const sqlParams: unknown[] = [];
  let paramIdx = 1;
  let baseWhere = '';

  if (!hasCallId) {
    if (role === 'admin') {
      sqlParams.push(effectiveDispositions);
      const dispParam = paramIdx++;
      baseWhere = reviewedMode
        ? `ce.status = 'reviewed' AND (EXISTS (SELECT 1 FROM unnest($${dispParam}::text[]) d WHERE LOWER(cr.call_disposition) = LOWER(d)) OR ce.reviewed_by IS NOT NULL)`
        : `EXISTS (SELECT 1 FROM unnest($${dispParam}::text[]) d WHERE LOWER(cr.call_disposition) = LOWER(d)) AND ce.status IN ('pending', 'reopened') AND ce.iqs_percent IS NOT NULL AND (ce.iqs_percent <= 85 OR ce.verdict = 'FAILED_CRITICAL')`;
    } else {
      sqlParams.push(effectiveDispositions);
      const dispParam = paramIdx++;
      if (reviewedMode) {
        const emailIdx = paramIdx++;
        sqlParams.push(email.toLowerCase());
        baseWhere = `ce.status = 'reviewed' AND (EXISTS (SELECT 1 FROM unnest($${dispParam}::text[]) d WHERE LOWER(cr.call_disposition) = LOWER(d)) OR LOWER(COALESCE(ce.reviewed_by, '')) = $${emailIdx})`;
      } else {
        baseWhere = `EXISTS (SELECT 1 FROM unnest($${dispParam}::text[]) d WHERE LOWER(cr.call_disposition) = LOWER(d)) AND ce.status IN ('pending', 'reopened') AND ce.iqs_percent IS NOT NULL AND (ce.iqs_percent <= 85 OR ce.verdict = 'FAILED_CRITICAL')`;
      }
    }
  } else {
    baseWhere = reviewedMode
      ? `ce.status = 'reviewed'`
      : `ce.status IN ('pending', 'reopened')`;
  }

  let extraWhere = '';
  const filters: Record<string, unknown> = {};

  if (hasCallId && callId) {
    const pIdx = paramIdx++;
    extraWhere += ` AND (ce.call_id LIKE $${pIdx} OR ce.chat_id LIKE $${pIdx})`;
    sqlParams.push(`${callId.trim()}%`);
    filters.callId = callId.trim();
  }

  const subDispos = searchParams.getAll('sub_disposition');
  if (subDispos.length) {
    extraWhere += ` AND cr.call_sub_disposition = ANY($${paramIdx++})`;
    sqlParams.push(subDispos);
    filters.subDispo = subDispos;
  }

  // Dates handling (IST)
  const from = searchParams.get('from');
  if (from) {
    const fromDate = new Date(from + 'T00:00:00+05:30');
    if (!isNaN(fromDate.getTime())) {
      const fromUTC = fromDate.toISOString();
      extraWhere += ` AND cr.called_at >= $${paramIdx++}`;
      sqlParams.push(fromUTC);
      filters.from = from;
    }
  }

  const to = searchParams.get('to');
  if (to) {
    const toDate = new Date(to + 'T23:59:59+05:30');
    if (!isNaN(toDate.getTime())) {
      const toUTC = toDate.toISOString();
      extraWhere += ` AND cr.called_at <= $${paramIdx++}`;
      sqlParams.push(toUTC);
      filters.to = to;
    }
  }

  const iqsMin = searchParams.get('iqs_min');
  if (iqsMin) {
    extraWhere += ` AND ce.iqs_percent >= $${paramIdx++}`;
    sqlParams.push(parseInt(iqsMin));
    filters.iqsMin = parseInt(iqsMin);
  }

  const iqsMax = searchParams.get('iqs_max');
  if (iqsMax !== null && iqsMax !== '') {
    extraWhere += ` AND ce.iqs_percent <= $${paramIdx++}`;
    sqlParams.push(parseInt(iqsMax));
    filters.iqsMax = parseInt(iqsMax);
  }

  // Status filter (e.g. 'reopened')
  const statusParam = searchParams.get('status');
  if (statusParam) {
    extraWhere += ` AND ce.status = $${paramIdx++}`;
    sqlParams.push(statusParam);
    filters.status = statusParam;
  }

  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  // Count query
  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM call_evaluations ce
     JOIN call_recordings cr ON cr.id = ce.call_id
     WHERE ${baseWhere}${extraWhere}`,
    sqlParams
  );
  const total = parseInt(countRows[0]?.total ?? '0');

  // Data query
  const dataSqlParams = [...sqlParams, limit, offset];
  const limitParamIdx = paramIdx++;
  const offsetParamIdx = paramIdx++;

  const rows = await query<any>(
    `SELECT ce.call_id, COALESCE(ce.chat_id, cr.chat_id) as chat_id, COALESCE(a.name, 'Unknown') as agent_name,
            ce.iqs_percent, ce.verdict, cr.called_at, cr.call_disposition, cr.call_sub_disposition,
            cr.duration_seconds, cr.language, cr.interruption_count, cr.dead_air_count,
            ce.reviewed_by, ce.reviewed_at, ce.review_note, ce.status, ce.gates, ce.iqs_scores
     FROM call_evaluations ce
     JOIN call_recordings cr ON cr.id = ce.call_id
     LEFT JOIN agents a ON a.id = ce.agent_id
     WHERE ${baseWhere}${extraWhere}
     ORDER BY ${reviewedMode ? 'ce.reviewed_at DESC' : 'ce.scored_at DESC'}
     LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
    dataSqlParams
  );

  const calls: CallToReviewRow[] = rows.map(r => ({
    callId:                 r.call_id,
    chatId:                 r.chat_id,
    agentName:              r.agent_name,
    iqsScore:               r.iqs_percent ? Math.round(parseFloat(r.iqs_percent)) : null,
    verdict:                r.verdict,
    calledAt:               r.called_at,
    disposition:            r.call_disposition,
    subDisposition:         r.call_sub_disposition,
    durationSeconds:        r.duration_seconds,
    language:               r.language,
    interruptionCount:      r.interruption_count || 0,
    deadAirCount:           r.dead_air_count || 0,
    reviewedBy:             r.reviewed_by,
    reviewedAt:             r.reviewed_at,
    reviewNote:             r.review_note,
    status:                 r.status,
    gates:                  r.gates,
    iqsScores:              r.iqs_scores
  }));

  return NextResponse.json({ calls, total });
});
