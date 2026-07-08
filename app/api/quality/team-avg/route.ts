import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { avgOrNull as avg } from '@/lib/stats';
import { getAllScoredConversations } from '@/lib/robylon/db';
import { PARAM_ORDER } from '@/lib/quality';

const SLA_SECS = 180;

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo   = searchParams.get('dateTo') || '';

  const rawRows = await getAllScoredConversations(0);

  let entries = rawRows.map(row => ({
    agentName:      (row.agentName as string | null) || 'Unknown',
    scoredAt:       row.scoredAt as string | undefined,
    iqs:            row.iqs as number,
    frt:            row.frt as number | undefined,
    resolutionTime: row.resolutionTime as number | undefined,
    botToTeamSecs:  row.botToTeamSecs as number | undefined,
    csatScore:      row.csat_score as number | null,
    parameters:     row.parameters as Record<string, { score: boolean | null }> | null,
  }));

  if (dateFrom) entries = entries.filter(e => (e.scoredAt || '').slice(0, 10) >= dateFrom);
  if (dateTo)   entries = entries.filter(e => (e.scoredAt || '').slice(0, 10) <= dateTo);

  const resValues  = entries.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
  const frtValues  = entries.map(e => e.frt).filter((v): v is number => typeof v === 'number');
  const iqsVals    = entries.map(e => e.iqs).filter((v): v is number => typeof v === 'number');
  const csatScores: number[] = entries.reduce<number[]>((acc, e) => {
    if (e.csatScore === 5) acc.push(100);
    else if (e.csatScore === 3) acc.push(50);
    else if (e.csatScore === 1) acc.push(0);
    return acc;
  }, []);

  const b2tValues = entries.map(e => e.botToTeamSecs).filter((v): v is number => typeof v === 'number');
  const slaOk = b2tValues.filter(v => v <= SLA_SECS).length;

  // ── Top-3 agent benchmark (per-parameter pass rates, anonymised) ─────────────
  // Group by agent, compute avg IQS, pick top 3, then compute their param pass rates
  const agentMap: Record<string, { iqs: number[]; params: Record<string, { yes: number; total: number }> }> = {};
  for (const e of entries) {
    const a = e.agentName;
    if (!agentMap[a]) agentMap[a] = { iqs: [], params: {} };
    agentMap[a].iqs.push(e.iqs);
    if (e.parameters) {
      for (const [rawKey, val] of Object.entries(e.parameters)) {
        // DB stores snake_case; map to legacy PascalCase used in PARAM_ORDER
        const DB_TO_PARAM: Record<string, string> = {
          technical: 'Technical', all_questions: 'AllQuestions', expectation: 'Expectation',
          contextual: 'Contextual', follow_up: 'FollowUp', sentences: 'Sentences',
          process: 'Process', opening: 'Opening', call: 'Call', tags: 'Tags',
          grammar: 'Grammar', empathy: 'Empathy',
        };
        const key = DB_TO_PARAM[rawKey] ?? rawKey;
        if (!agentMap[a].params[key]) agentMap[a].params[key] = { yes: 0, total: 0 };
        if (val.score !== null) {
          agentMap[a].params[key].total++;
          if (val.score === true) agentMap[a].params[key].yes++;
        }
      }
    }
  }

  const agentList = Object.entries(agentMap).map(([name, d]) => ({
    name,
    avgIqs: d.iqs.length ? Math.round(d.iqs.reduce((s, n) => s + n, 0) / d.iqs.length) : 0,
    params: d.params,
  })).filter(a => a.avgIqs > 0);

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
    totalEntries: entries.length,
    avgIqs:        avg(iqsVals),
    avgFrt:        avg(frtValues),
    avgResolution: avg(resValues),
    avgClosure:    null,
    avgCsat:       avg(csatScores),
    slaPercent:    b2tValues.length > 0 ? Math.round((slaOk / b2tValues.length) * 100) : null,
    top3ParamRates,
    top3Count:     agentList.length,
  });
}
