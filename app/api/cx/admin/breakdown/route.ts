import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { calculateWeightedOverallIQS } from '@/lib/quality';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';

const CSAT = `CASE WHEN c.csat_score=5 THEN 100 WHEN c.csat_score=3 THEN 50 WHEN c.csat_score=1 THEN 0 END`;

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
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const view     = searchParams.get('view') === 'qa' ? 'qa' : 'tl';
  const dateFrom = searchParams.get('dateFrom') || null;
  const dateTo   = searchParams.get('dateTo')   || null;

  const groupCol     = view === 'tl' ? 'a.tl_name' : 'a.qa_name';
  const counterCol   = view === 'tl' ? 'a.qa_name' : 'a.tl_name';

  // Check if tl_name/qa_name columns exist (added by migration)
  const colCheck = await query<{column_name: string}>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name IN ('tl_name','qa_name')
  `);
  if (colCheck.length < 2) {
    return NextResponse.json(
      { error: 'migration_required', detail: 'POST /api/admin/migrate to add tl_name/qa_name columns' },
      { status: 503 }
    );
  }

  // Agent-level metrics
  const agentRowsRaw = await query<any>(`
    SELECT
      a.id::text                                                  AS agent_id,
      a.name                                                      AS agent_name,
      COALESCE(${groupCol}, '__unassigned__')                     AS group_name,
      COALESCE(${counterCol}, '—')                                AS counterpart,
      COUNT(c.id)::int                                            AS volume,
      ROUND(AVG(${CSAT})::numeric,1)::float                       AS csat_pct,
      ROUND(AVG(s.iqs_score)::numeric,1)::float                   AS avg_iqs,
      ROUND(AVG(c.resolution_seconds)::numeric,0)::int            AS avg_resolution,
      ROUND(AVG(c.frt_seconds)::numeric,0)::int                   AS avg_frt,
      ROUND(AVG(c.bot_to_team_seconds)::numeric,0)::int           AS avg_handoff,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM agents a
    JOIN conversations c ON c.agent_id = a.id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE ($1::date IS NULL OR c.closed_at::date >= $1::date)
      AND ($2::date IS NULL OR c.closed_at::date <= $2::date)
    GROUP BY a.id, a.name, group_name, counterpart
  `, [dateFrom, dateTo]);

  const agentRows = agentRowsRaw.map((a: any) => {
    const pooled = extractPooledParams(a.parameters);
    const weighted = calculateWeightedOverallIQS(pooled, 'human', { roundDecimals: 1 });
    const { parameters, ...rest } = a;
    return {
      ...rest,
      avg_iqs: weighted ?? a.avg_iqs,
    };
  }).sort((a: any, b: any) => (b.avg_iqs ?? -1) - (a.avg_iqs ?? -1));

  // Group-level metrics (conversation-level aggregation = correct)
  const groupRowsRaw = await query<any>(`
    SELECT
      COALESCE(${groupCol}, '__unassigned__')                     AS entity_name,
      COUNT(DISTINCT a.id)::int                                   AS agent_count,
      COUNT(c.id)::int                                            AS volume,
      ROUND(AVG(${CSAT})::numeric,1)::float                       AS csat_pct,
      ROUND(AVG(s.iqs_score)::numeric,1)::float                   AS avg_iqs,
      ROUND(AVG(c.resolution_seconds)::numeric,0)::int            AS avg_resolution,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM agents a
    JOIN conversations c ON c.agent_id = a.id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE ($1::date IS NULL OR c.closed_at::date >= $1::date)
      AND ($2::date IS NULL OR c.closed_at::date <= $2::date)
    GROUP BY entity_name
  `, [dateFrom, dateTo]);

  const groupRows = groupRowsRaw.map((g: any) => {
    const pooled = extractPooledParams(g.parameters);
    const weighted = calculateWeightedOverallIQS(pooled, 'human', { roundDecimals: 1 });
    const { parameters, ...rest } = g;
    return {
      ...rest,
      avg_iqs: weighted ?? g.avg_iqs,
    };
  }).sort((a: any, b: any) => (b.avg_iqs ?? -1) - (a.avg_iqs ?? -1));

  // Attach agents to each group
  const byGroup: Record<string, Array<{
    agent_id: string; name: string; counterpart: string;
    volume: number; csat_pct: number | null; avg_iqs: number | null;
    avg_resolution: number | null; avg_frt: number | null; avg_handoff: number | null;
  }>> = {};
  for (const a of agentRows) {
    if (!byGroup[a.group_name]) byGroup[a.group_name] = [];
    byGroup[a.group_name].push({
      agent_id: a.agent_id, name: a.agent_name, counterpart: a.counterpart,
      volume: a.volume, csat_pct: a.csat_pct, avg_iqs: a.avg_iqs,
      avg_resolution: a.avg_resolution, avg_frt: a.avg_frt, avg_handoff: a.avg_handoff,
    });
  }

  const groups = groupRows.map(g => ({
    entity_name:    g.entity_name === '__unassigned__' ? 'Unassigned' : g.entity_name,
    agent_count:    g.agent_count,
    volume:         g.volume,
    csat_pct:       g.csat_pct,
    avg_iqs:        g.avg_iqs,
    avg_resolution: g.avg_resolution,
    agents:         byGroup[g.entity_name] || [],
  }));

  return NextResponse.json(groups);
}
