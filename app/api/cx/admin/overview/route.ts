import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('dateFrom') || null;
  const dateTo   = searchParams.get('dateTo')   || null;

  const [row] = await query(`
    SELECT
      COUNT(c.id)::int AS volume,

      -- CSAT overall
      ROUND(AVG(CASE WHEN c.csat_score=5 THEN 100 WHEN c.csat_score=3 THEN 50 WHEN c.csat_score=1 THEN 0 END)::numeric,1)::float AS csat_pct,
      COUNT(CASE WHEN c.csat_score=5 THEN 1 END)::int                   AS csat_good,
      COUNT(CASE WHEN c.csat_score=3 THEN 1 END)::int                   AS csat_cbb,
      COUNT(CASE WHEN c.csat_score=1 THEN 1 END)::int                   AS csat_bad,
      COUNT(CASE WHEN c.csat_score IS NOT NULL THEN 1 END)::int          AS with_csat,

      -- IQS overall + tier distribution
      ROUND(AVG(s.iqs_score)::numeric,1)::float                          AS avg_iqs,
      COUNT(CASE WHEN s.iqs_score >= 85 THEN 1 END)::int                 AS iqs_excellent,
      COUNT(CASE WHEN s.iqs_score >= 70 AND s.iqs_score < 85 THEN 1 END)::int AS iqs_warn,
      COUNT(CASE WHEN s.iqs_score < 70 AND s.iqs_score IS NOT NULL THEN 1 END)::int AS iqs_risk,
      COUNT(CASE WHEN s.iqs_score IS NOT NULL THEN 1 END)::int            AS with_iqs,

      -- Timing
      ROUND(AVG(c.resolution_seconds)::numeric,0)::int                   AS avg_resolution,
      ROUND(AVG(c.frt_seconds)::numeric,0)::int                          AS avg_frt,
      ROUND(AVG(c.bot_to_team_seconds)::numeric,0)::int                  AS avg_handoff,
      COUNT(CASE WHEN c.frt_seconds IS NOT NULL AND c.frt_seconds <= 180 THEN 1 END)::int AS frt_sla_met,
      COUNT(CASE WHEN c.frt_seconds IS NOT NULL THEN 1 END)::int         AS with_frt,

      -- Bot vs Agent split
      COUNT(CASE WHEN c.conversation_type = 'bot'    THEN 1 END)::int   AS bot_volume,
      COUNT(CASE WHEN c.conversation_type = 'agent'  THEN 1 END)::int   AS agent_volume,
      COUNT(CASE WHEN c.conversation_type = 'hybrid' THEN 1 END)::int   AS hybrid_volume,
      ROUND(AVG(CASE WHEN c.conversation_type = 'bot'   AND c.csat_score=5 THEN 100
                     WHEN c.conversation_type = 'bot'   AND c.csat_score=3 THEN 50
                     WHEN c.conversation_type = 'bot'   AND c.csat_score=1 THEN 0 END)::numeric,1)::float AS bot_csat_pct,
      ROUND(AVG(CASE WHEN c.conversation_type = 'agent' AND c.csat_score=5 THEN 100
                     WHEN c.conversation_type = 'agent' AND c.csat_score=3 THEN 50
                     WHEN c.conversation_type = 'agent' AND c.csat_score=1 THEN 0 END)::numeric,1)::float AS agent_csat_pct,
      ROUND(AVG(CASE WHEN c.conversation_type = 'bot'   THEN c.frt_seconds END)::numeric,0)::int AS bot_avg_frt,
      ROUND(AVG(CASE WHEN c.conversation_type = 'agent' THEN c.frt_seconds END)::numeric,0)::int AS agent_avg_frt,
      ROUND(AVG(CASE WHEN c.conversation_type = 'bot'   THEN c.resolution_seconds END)::numeric,0)::int AS bot_avg_resolution,
      ROUND(AVG(CASE WHEN c.conversation_type = 'agent' THEN c.resolution_seconds END)::numeric,0)::int AS agent_avg_resolution

    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE ($1::date IS NULL OR c.closed_at::date >= $1::date)
      AND ($2::date IS NULL OR c.closed_at::date <= $2::date)
  `, [dateFrom, dateTo]);

  return NextResponse.json(row ?? {});
}
