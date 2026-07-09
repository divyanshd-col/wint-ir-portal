const ROUTE = 'quality/team-avg';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getScoredConversationsSummary } from '@/lib/robylon/db';
import { PARAM_ORDER } from '@/lib/quality';
import { query } from '@/lib/cx/db';

const PARAM_DB_KEYS: Record<string, string> = {
  Opening: 'opening',
  Grammar: 'grammar',
  Sentences: 'sentences',
  Empathy: 'empathy',
  AllQuestions: 'all_questions',
  Contextual: 'contextual',
  Technical: 'technical',
  Expectation: 'expectation',
  FollowUp: 'follow_up',
  Process: 'process',
  Tags: 'tags',
  Call: 'call'
};

async function _GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo   = searchParams.get('dateTo') || '';

  // Get overall summary using cheap SQL aggregates
  const summary = await getScoredConversationsSummary({ dateFrom, dateTo });

  // Get agent grouped stats for top-3 benchmark
  const filterConditions: string[] = [];
  const params: any[] = [];
  if (dateFrom) {
    params.push(dateFrom);
    filterConditions.push(`c.closed_at::date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    filterConditions.push(`c.closed_at::date <= $${params.length}`);
  }
  const where = filterConditions.length ? `WHERE ${filterConditions.join(' AND ')}` : '';

  const selectParts = Object.entries(PARAM_DB_KEYS).map(([pascalKey, dbKey]) => {
    return `
      COUNT(*) FILTER (WHERE (s.parameters->'${dbKey}'->>'score')::boolean = true)::int AS "${dbKey}_yes",
      COUNT(*) FILTER (WHERE s.parameters->'${dbKey}'->'score' IS NOT NULL AND s.parameters->'${dbKey}'->>'score' != 'null')::int AS "${dbKey}_total"
    `;
  }).join(', ');

  const agentRows = await query<any>(`
    SELECT
      COALESCE(a.name, 'Unknown') AS "agentName",
      AVG(s.iqs_score) AS "avgIqs",
      ${selectParts}
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
    GROUP BY COALESCE(a.name, 'Unknown')
  `, params);

  const agentList = agentRows.map((row: any) => {
    const name = row.agentName;
    const avgIqs = row.avgIqs != null ? Math.round(Number(row.avgIqs)) : 0;
    const pData: Record<string, { yes: number; total: number }> = {};
    for (const [pascalKey, dbKey] of Object.entries(PARAM_DB_KEYS)) {
      pData[pascalKey] = {
        yes: row[`${dbKey}_yes`] || 0,
        total: row[`${dbKey}_total`] || 0,
      };
    }
    return { name, avgIqs, params: pData };
  }).filter(a => a.avgIqs > 0);

  // Per-parameter top-3: for each param find top-3 agents by pass rate, average their rates
  const top3ParamRates: Record<string, number | null> = {};
  for (const p of PARAM_ORDER) {
    const ranked = agentList
      .filter(a => (a.params[p]?.total ?? 0) >= 3)  // at least 3 samples for reliability
      .map(a => ({ name: a.name, rate: Math.round((a.params[p].yes / a.params[p].total) * 100) }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);
    top3ParamRates[p] = ranked.length > 0
      ? Math.round(ranked.reduce((s, a) => s + a.rate, 0) / ranked.length)
      : null;
  }

  return NextResponse.json({
    totalEntries: summary.totalConvos,
    avgIqs:        summary.avgIqs,
    avgFrt:        summary.avgFrt,
    avgResolution: summary.avgResolution,
    avgClosure:    null,
    avgCsat:       summary.overallCsat,
    slaPercent:    summary.slaPercent,
    top3ParamRates,
    top3Count:     agentList.length,
  }, {
    headers: {
      'Cache-Control': 'private, max-age=30',
    }
  });
}

export const GET = withLogging(ROUTE, _GET);
