import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetIQSScores, storeGetIQSScoreCount } from '@/lib/store';
import type { IQSScoreEntry } from '@/lib/quality';

function qualityAccess(session: any): boolean {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl'].includes(role);
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
  // display limit — only affects what's returned to the UI, not what's stored
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 0; // 0 = no limit

  const [raw, totalStored] = await Promise.all([
    storeGetIQSScores(),
    storeGetIQSScoreCount(),
  ]);

  let entries: IQSScoreEntry[] = raw.map(r => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean);

  // Build available agents from the full unfiltered set
  const availableAgents = [...new Set(entries.map(e => e.agentName).filter(Boolean))].sort();

  // Apply filters
  if (agentFilter) entries = entries.filter(e => e.agentName === agentFilter);
  if (tagFilter)   entries = entries.filter(e => (e.tags || '').toLowerCase().includes(tagFilter.toLowerCase()));
  if (dateFrom)    entries = entries.filter(e => (e.date || e.scoredAt?.slice(0, 10)) >= dateFrom);
  if (dateTo)      entries = entries.filter(e => (e.date || e.scoredAt?.slice(0, 10)) <= dateTo);
  entries = entries.filter(e => e.iqs >= minScore && e.iqs <= maxScore);

  const totalFiltered = entries.length;

  // Apply display limit (newest-first, LPUSH order)
  if (limit > 0) entries = entries.slice(0, limit);

  // Agent stats — computed over ALL filtered entries (not just the display page)
  const agentMap: Record<string, { total: number; sum: number; scores: number[] }> = {};
  const filteredForStats: IQSScoreEntry[] = raw.map(r => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean).filter(e => {
    if (agentFilter && e.agentName !== agentFilter) return false;
    if (tagFilter && !(e.tags || '').toLowerCase().includes(tagFilter.toLowerCase())) return false;
    if (dateFrom && (e.date || e.scoredAt?.slice(0, 10)) < dateFrom) return false;
    if (dateTo && (e.date || e.scoredAt?.slice(0, 10)) > dateTo) return false;
    if (e.iqs < minScore || e.iqs > maxScore) return false;
    return true;
  });

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

  // Param failure rates across all filtered entries
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

  return NextResponse.json({
    entries,
    agentStats,
    paramFails,
    availableAgents,
    total: totalFiltered,       // filtered count
    totalStored,                 // total ever stored (no cap)
  });
}
