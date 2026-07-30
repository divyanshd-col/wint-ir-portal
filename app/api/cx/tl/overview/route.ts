import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { calculateWeightedOverallIQS } from '@/lib/quality';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';

function extractPooledParams(paramsArray: any[]): Record<string, { yes: number; half: number; total: number }> {
  const pooled: Record<string, { yes: number; half: number; total: number }> = {};
  if (!Array.isArray(paramsArray)) return pooled;
  for (const paramObj of paramsArray) {
    if (!paramObj) continue;
    const targetObj = paramObj.__agent_parameters || paramObj;
    for (const [rawKey, val] of Object.entries(targetObj as Record<string, any>)) {
      if (rawKey.startsWith('__')) continue;
      const pk = ALL_DB_KEY_TO_PASCAL[rawKey] ?? rawKey;
      if (!pooled[pk]) pooled[pk] = { yes: 0, half: 0, total: 0 };
      const score = val?.score;
      if (score === true || score === 'Yes' || score === 1 || score === '1') {
        pooled[pk].yes++; pooled[pk].total++;
      } else if (score === 0.5 || score === 'Half') {
        pooled[pk].half++; pooled[pk].total++;
      } else if (score === false || score === 'No' || score === 0 || score === '0') {
        pooled[pk].total++;
      }
    }
  }
  return pooled;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  if (role !== 'tl' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('dateFrom') || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const dateTo   = searchParams.get('dateTo')   || new Date().toISOString().slice(0, 10);

  const [summaryRow] = await query(`
    SELECT
      COUNT(c.id)::int AS total_convs,
      COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::int AS bad_csat_count,
      ROUND(
        COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS bad_csat_pct,
      ROUND(AVG(s.iqs_score)::numeric, 1)::float AS avg_iqs,
      ROUND(AVG(c.resolution_seconds)::numeric / 60, 0)::int AS avg_resolution_mins,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
  `, [dateFrom, dateTo]);

  if (summaryRow) {
    const pooled = extractPooledParams(summaryRow.parameters);
    const weighted = calculateWeightedOverallIQS(pooled, 'human', { roundDecimals: 1 });
    if (weighted != null) summaryRow.avg_iqs = weighted;
    delete summaryRow.parameters;
  }

  const agentRowsRaw = await query<any>(`
    SELECT
      a.id   AS agent_id,
      a.name AS agent_name,
      COUNT(c.id)::int AS conv_count,
      COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::int AS bad_csat_count,
      ROUND(
        COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS bad_csat_pct,
      ROUND(AVG(s.iqs_score)::numeric, 1)::float AS avg_iqs,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM agents a
    JOIN conversations c ON c.agent_id = a.id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
    GROUP BY a.id, a.name
    ORDER BY conv_count DESC
  `, [dateFrom, dateTo]);

  const agentRows = agentRowsRaw.map((a: any) => {
    const pooled = extractPooledParams(a.parameters);
    const weighted = calculateWeightedOverallIQS(pooled, 'human', { roundDecimals: 1 });
    const { parameters, ...rest } = a;
    return {
      ...rest,
      avg_iqs: weighted ?? a.avg_iqs,
    };
  });

  const dispRowsRaw = await query<any>(`
    SELECT
      COALESCE((c.tags::jsonb)->>'disposition', 'Unknown') AS disposition,
      COUNT(c.id)::int AS conv_count,
      COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::int AS bad_csat_count,
      ROUND(
        COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS bad_csat_pct,
      ROUND(AVG(s.iqs_score)::numeric, 1)::float AS avg_iqs,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
    GROUP BY disposition
    ORDER BY bad_csat_pct DESC NULLS LAST
    LIMIT 10
  `, [dateFrom, dateTo]);

  const dispRows = dispRowsRaw.map((d: any) => {
    const pooled = extractPooledParams(d.parameters);
    const weighted = calculateWeightedOverallIQS(pooled, 'human', { roundDecimals: 1 });
    const { parameters, ...rest } = d;
    return {
      ...rest,
      avg_iqs: weighted ?? d.avg_iqs,
    };
  });

  const subDispRows = await query(`
    SELECT
      (c.tags::jsonb)->>'sub_disposition' AS sub_disposition,
      COUNT(c.id)::int AS conv_count,
      COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::int AS bad_csat_count,
      ROUND(
        COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS bad_csat_pct
    FROM conversations c
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
      AND (c.tags::jsonb)->>'sub_disposition' IS NOT NULL
      AND (c.tags::jsonb)->>'sub_disposition' != ''
    GROUP BY sub_disposition
    ORDER BY bad_csat_pct DESC NULLS LAST
    LIMIT 10
  `, [dateFrom, dateTo]);

  const paramRows = await query(`
    SELECT
      p.key AS param_name,
      COUNT(*) FILTER (WHERE (p.val->>'score') = 'false') AS fail_count,
      COUNT(*) FILTER (
        WHERE p.val->>'score' IS NOT NULL
          AND p.val->>'score' NOT IN ('null','')
      ) AS scored_count,
      ROUND(
        COUNT(*) FILTER (WHERE (p.val->>'score') = 'false')::numeric
        / NULLIF(COUNT(*) FILTER (
            WHERE p.val->>'score' IS NOT NULL
              AND p.val->>'score' NOT IN ('null','')
          ), 0) * 100, 1
      )::float AS fail_rate
    FROM iqs_scores s
    JOIN conversations c ON c.id = s.chat_id
    CROSS JOIN LATERAL jsonb_each(
      COALESCE(
        CASE WHEN s.parameters::text LIKE '{%' THEN s.parameters::jsonb ELSE NULL END,
        '{}'::jsonb
      )
    ) AS p(key, val)
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
      AND s.parameters IS NOT NULL
    GROUP BY p.key
    HAVING COUNT(*) > 0
    ORDER BY fail_rate DESC NULLS LAST
  `, [dateFrom, dateTo]);

  return NextResponse.json({
    summary:        summaryRow ?? {},
    agents:         agentRows,
    dispositions:   dispRows,
    sub_dispositions: subDispRows,
    iqs_params:     paramRows,
  });
}
