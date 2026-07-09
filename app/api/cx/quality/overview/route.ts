const ROUTE = 'cx/quality/overview';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

async function _GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  if (!['quality', 'admin', 'tl'].includes(role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('dateFrom') || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const dateTo   = searchParams.get('dateTo')   || new Date().toISOString().slice(0, 10);

  const [summaryRow] = await query(`
    SELECT
      COUNT(c.id)::int AS total_convs,
      COUNT(s.chat_id)::int AS scored_count,
      ROUND(AVG(s.iqs_score)::numeric, 1)::float AS avg_iqs,
      COUNT(CASE WHEN s.iqs_score < 60 THEN 1 END)::int AS low_iqs_count,
      COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::int AS bad_csat_count,
      ROUND(
        COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS bad_csat_pct
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
  `, [dateFrom, dateTo]);

  const agentRows = await query(`
    SELECT
      a.id   AS agent_id,
      a.name AS agent_name,
      COUNT(c.id)::int AS conv_count,
      COUNT(s.chat_id)::int AS scored_count,
      ROUND(AVG(s.iqs_score)::numeric, 1)::float AS avg_iqs,
      COUNT(CASE WHEN s.iqs_score < 60 THEN 1 END)::int AS low_iqs_count,
      ROUND(
        COUNT(CASE WHEN c.csat_label IN ('bad','could_be_better') THEN 1 END)::numeric
        / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END), 0) * 100, 1
      )::float AS bad_csat_pct
    FROM agents a
    JOIN conversations c ON c.agent_id = a.id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
    GROUP BY a.id, a.name
    ORDER BY avg_iqs ASC NULLS LAST
  `, [dateFrom, dateTo]);

  const paramRows = await query(`
    SELECT
      p.key AS param_name,
      COUNT(*) FILTER (WHERE (p.val->>'score') = 'false') AS fail_count,
      COUNT(*) FILTER (WHERE (p.val->>'score') = 'true')  AS pass_count,
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

  // Conversations needing attention: low IQS or bad CSAT
  const attentionRows = await query(`
    SELECT
      c.id AS chat_id,
      a.name AS agent_name,
      c.csat_label,
      ROUND(s.iqs_score::numeric, 1)::float AS iqs_score,
      COALESCE((c.tags::jsonb)->>'disposition', 'Unknown') AS disposition,
      c.closed_at
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
      AND (s.iqs_score < 60 OR c.csat_label IN ('bad','could_be_better'))
    ORDER BY s.iqs_score ASC NULLS LAST
    LIMIT 20
  `, [dateFrom, dateTo]);

  return NextResponse.json({
    summary:    summaryRow ?? {},
    agents:     agentRows,
    iqs_params: paramRows,
    attention:  attentionRows,
  });
}

export const GET = withLogging(ROUTE, _GET);
