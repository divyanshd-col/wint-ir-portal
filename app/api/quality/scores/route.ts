import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetIQSScores, storeGetIQSScoreCount } from '@/lib/store';
import type { IQSScoreEntry } from '@/lib/quality';

const SLA_THRESHOLD_SECS = 180; // 3 minutes B→T SLA

function qualityAccess(session: any): boolean {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl'].includes(role);
}

/** Compute CSAT score 0-100 (Good=100, CBB=50, Bad=0) */
function csatScore(csat: string | undefined): number | null {
  if (csat === '5') return 100;
  if (csat === '3') return 50;
  if (csat === '1') return 0;
  return null;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function avgOrNull(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const agentFilter = searchParams.get('agent') || '';
  const minScore    = searchParams.get('minScore') ? parseInt(searchParams.get('minScore')!) : 0;
  const maxScore    = searchParams.get('maxScore') ? parseInt(searchParams.get('maxScore')!) : 100;
  const tagFilter   = searchParams.get('tag') || '';
  const dateFrom    = searchParams.get('dateFrom') || '';
  const dateTo      = searchParams.get('dateTo') || '';
  const typeFilter  = searchParams.get('type') || ''; // 'bot' | 'agent' | 'hybrid'
  const limit       = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 0;

  const [raw, totalStored] = await Promise.all([
    storeGetIQSScores(),
    storeGetIQSScoreCount(),
  ]);

  let entries: IQSScoreEntry[] = raw.map(r => {
    try {
      const e = JSON.parse(r);
      // Strip transcript from old entries that were stored before the size fix
      if (e && e.transcript) delete e.transcript;
      return e;
    } catch { return null; }
  }).filter(Boolean);

  // Build available agents from the full unfiltered set
  const availableAgents = [...new Set(entries.map(e => e.agentName).filter(Boolean))].sort();

  // Apply filters
  if (agentFilter) entries = entries.filter(e => e.agentName === agentFilter);
  if (tagFilter)   entries = entries.filter(e => (e.tags || '').toLowerCase().includes(tagFilter.toLowerCase()));
  if (dateFrom)    entries = entries.filter(e => (e.date || e.scoredAt?.slice(0, 10)) >= dateFrom);
  if (dateTo)      entries = entries.filter(e => (e.date || e.scoredAt?.slice(0, 10)) <= dateTo);
  if (typeFilter)  entries = entries.filter(e => (e.conversationType || 'agent') === typeFilter);
  entries = entries.filter(e => e.iqs >= minScore && e.iqs <= maxScore);

  const totalFiltered = entries.length;

  // Apply display limit
  const displayEntries = limit > 0 ? entries.slice(0, limit) : entries;

  // ── Stats over ALL filtered entries (pre-limit) ────────────────────────────
  const filteredForStats = entries; // already filtered above

  // Agent stats
  const agentMap: Record<string, { total: number; sum: number; scores: number[] }> = {};
  for (const e of filteredForStats) {
    const a = e.agentName || 'Unknown';
    if (!agentMap[a]) agentMap[a] = { total: 0, sum: 0, scores: [] };
    agentMap[a].total++;
    agentMap[a].sum += e.iqs;
    agentMap[a].scores.push(e.iqs);
  }
  const agentStats = Object.entries(agentMap).map(([agent, d]) => ({
    agent,
    chats: d.total,
    avgIqs: Math.round(d.sum / d.total),
    minIqs: Math.min(...d.scores),
    maxIqs: Math.max(...d.scores),
    high: d.scores.filter(s => s >= 90).length,
    atRisk: d.scores.filter(s => s < 70).length,
  })).sort((a, b) => b.avgIqs - a.avgIqs);

  // Param failure rates
  const paramFails: Record<string, number> = {};
  if (filteredForStats.length) {
    for (const e of filteredForStats) {
      for (const [p, v] of Object.entries(e.scores || {})) {
        if (v === 'No') paramFails[p] = (paramFails[p] || 0) + 1;
      }
    }
    for (const p of Object.keys(paramFails)) {
      paramFails[p] = Math.round((paramFails[p] / filteredForStats.length) * 100);
    }
  }

  // ── Summary metrics ────────────────────────────────────────────────────────
  const botEntries    = filteredForStats.filter(e => e.conversationType === 'bot');
  const agentEntries  = filteredForStats.filter(e => e.conversationType !== 'bot'); // agent + hybrid + undefined

  // CSAT
  const allCsatScores  = filteredForStats.map(e => csatScore(e.csat)).filter((v): v is number => v !== null);
  const botCsatScores  = botEntries.map(e => csatScore(e.csat)).filter((v): v is number => v !== null);
  const agentCsatScores = agentEntries.map(e => csatScore(e.csat)).filter((v): v is number => v !== null);

  const good   = filteredForStats.filter(e => e.csat === '5').length;
  const cbbBad = filteredForStats.filter(e => e.csat === '3' || e.csat === '1').length;
  const withCsat = filteredForStats.filter(e => e.csat === '5' || e.csat === '3' || e.csat === '1').length;

  // Timing (only entries that have the field)
  const frtValues       = filteredForStats.map(e => e.frt).filter((v): v is number => typeof v === 'number');
  const b2tValues       = filteredForStats.map(e => e.botToTeamSecs).filter((v): v is number => typeof v === 'number');
  const resValues       = filteredForStats.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
  const closeValues     = filteredForStats.map(e => e.closureTime).filter((v): v is number => typeof v === 'number');
  const slaOk           = b2tValues.filter(v => v <= SLA_THRESHOLD_SECS).length;

  // IQS over scored subset
  const iqsEntries     = filteredForStats.filter(e => e.iqs !== undefined);
  const iqsSampleSize  = iqsEntries.length;

  const summary = {
    totalConvos:   totalFiltered,
    botConvos:     botEntries.length,
    agentConvos:   agentEntries.length,
    overallCsat:   avgOrNull(allCsatScores),
    botCsat:       avgOrNull(botCsatScores),
    agentCsat:     avgOrNull(agentCsatScores),
    good,
    cbbBad,
    cbbBadPct:     withCsat > 0 ? Math.round((cbbBad / withCsat) * 100) : 0,
    avgFrt:        avgOrNull(frtValues),        // avg seconds I→T
    avgBotToTeam:  avgOrNull(b2tValues),        // avg seconds B→T
    slaPercent:    b2tValues.length > 0 ? Math.round((slaOk / b2tValues.length) * 100) : null,
    slaThresholdSecs: SLA_THRESHOLD_SECS,
    avgResolution: avgOrNull(resValues),        // avg seconds
    avgClosure:    avgOrNull(closeValues),      // avg seconds
    avgIqs:        iqsEntries.length ? avg(iqsEntries.map(e => e.iqs)) : null,
    iqsSampleSize,
    samplingPct:   totalFiltered > 0 ? Math.round((iqsSampleSize / totalFiltered) * 100) : 0,
  };

  return NextResponse.json({
    entries: displayEntries,
    agentStats,
    paramFails,
    availableAgents,
    total: totalFiltered,
    totalStored,
    summary,
  });
}
