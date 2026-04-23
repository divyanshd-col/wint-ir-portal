import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getAllScoredConversations, getAgentNamesByTL, getAgentNamesByQA } from '@/lib/robylon/db';
import { PARAM_ORDER } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';

const SLA_THRESHOLD_SECS = 180; // 3 minutes handoff SLA

const PAGE_SIZE = 50;

function qualityAccess(session: any): boolean {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl', 'agent'].includes(role);
}

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

function getWeekKey(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - day + 1);
  return mon.toISOString().slice(0, 10);
}

function getWeekLabel(key: string): string {
  const mon = new Date(key + 'T00:00:00Z');
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

// ── DB snake_case key → legacy PascalCase key used by the frontend ────────────
// DB stores: technical, all_questions, follow_up, sentences, ...
// Frontend expects: Technical, AllQuestions, FollowUp, Sentences, ...
const DB_KEY_TO_LEGACY: Record<string, string> = {
  technical:    'Technical',
  all_questions:'AllQuestions',
  expectation:  'Expectation',
  contextual:   'Contextual',
  follow_up:    'FollowUp',
  sentences:    'Sentences',
  process:      'Process',
  opening:      'Opening',
  call:         'Call',
  tags:         'Tags',
  grammar:      'Grammar',
  empathy:      'Empathy',
};

// ── Convert PostgreSQL row → IQSScoreEntry ────────────────────────────────────
function toIQSScoreEntry(row: any): IQSScoreEntry {
  const params = row.parameters || {};
  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  for (const [key, val] of Object.entries(params) as [string, any][]) {
    // Map DB snake_case key → legacy PascalCase; fall back to first-letter capitalize
    const k = DB_KEY_TO_LEGACY[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
    scores[k]    = val.score === true ? 'Yes' : val.score === false ? 'No' : 'NA';
    reasoning[k] = val.reasoning || '';
  }
  const csatStr = row.csat_score ? String(row.csat_score) : '';
  const tags = row.tags || {};
  return {
    id:              `${row.scoredAt}-${row.chatId}`,
    chatId:          row.chatId,
    scoredAt:        row.scoredAt,
    agentName:       row.agentName || '',
    date:            row.date ? String(row.date).slice(0, 10) : '',
    iqs:             row.iqs,
    csat:            csatStr,
    scores:          scores as Record<string, any>,
    reasoning,
    summary:         '',
    provider:        row.modelVersion?.includes('gemini') ? 'gemini' : 'claude',
    model:           row.modelVersion || '',
    conversationType: row.conversationType || 'agent',
    frt:             row.frt ?? undefined,
    botToTeamSecs:   row.botToTeamSecs ?? undefined,
    resolutionTime:  row.resolutionTime ?? undefined,
    disposition:     tags.disposition || '',
    subDisposition:  tags.sub_disposition || '',
  } as IQSScoreEntry;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page          = Math.max(0, parseInt(searchParams.get('page') || '0'));
  const skipStats     = searchParams.get('skipStats') === '1';
  const agentFilter   = searchParams.get('agent') || '';
  const minScore      = searchParams.get('minScore') ? parseInt(searchParams.get('minScore')!) : 0;
  const maxScore      = searchParams.get('maxScore') ? parseInt(searchParams.get('maxScore')!) : 100;
  const tagFilter     = searchParams.get('tag') || '';
  const subTagFilter  = searchParams.get('subTag') || '';
  const csatFilter    = searchParams.get('csat') || '';
  const dateFrom      = searchParams.get('dateFrom') || '';
  const dateTo        = searchParams.get('dateTo') || '';
  const typeFilter    = searchParams.get('type') || '';

  const role = session.user?.role;

  // Resolve the portal user's agentName for scoped roles
  let selfAgentName = '';
  let scopedAgentNames: string[] | null = null; // null = no scope restriction

  if (role === 'agent' || role === 'tl' || role === 'quality') {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig();
    const email = session.user?.email || '';
    const configUser = config.users.find(u => (u.email || u.username) === email);
    selfAgentName = configUser?.agentName || '';
  }

  if (role === 'agent' && selfAgentName) {
    scopedAgentNames = [selfAgentName];
  } else if (role === 'tl' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByTL(selfAgentName);
  } else if (role === 'quality' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByQA(selfAgentName);
  }

  // Push date + agent filters to DB
  const dbOpts: { dateFrom?: string; dateTo?: string; agentName?: string; agentNames?: string[] } = {};
  if (dateFrom) dbOpts.dateFrom = dateFrom;
  if (dateTo)   dbOpts.dateTo   = dateTo;
  if (scopedAgentNames) {
    // Further restrict by the requested agentFilter if one is active
    if (agentFilter) {
      dbOpts.agentName = agentFilter;
    } else {
      dbOpts.agentNames = scopedAgentNames;
    }
  } else if (agentFilter) {
    dbOpts.agentName = agentFilter;
  }

  let rawRows: any[] = [];
  try {
    rawRows = await getAllScoredConversations(0, dbOpts);
  } catch (dbErr: any) {
    console.error('[quality/scores] DB fetch failed:', dbErr?.message ?? dbErr);
    return NextResponse.json({ error: 'Database error', detail: dbErr?.message }, { status: 500 });
  }
  const totalStored = rawRows.length;
  console.log(`[quality/scores] DB returned ${totalStored} rows`);

  const allParsed: IQSScoreEntry[] = rawRows.map(row => {
    try { return toIQSScoreEntry(row); } catch (e: any) {
      console.error('[quality/scores] toIQSScoreEntry failed:', e?.message, JSON.stringify(row).slice(0, 200));
      return null;
    }
  }).filter(Boolean) as IQSScoreEntry[];

  // Derive available filter values from the fetched set
  const availableAgents           = [...new Set(allParsed.map(e => e.agentName).filter(Boolean))].sort() as string[];
  const availableDispositions     = [...new Set(allParsed.map(e => e.disposition).filter(Boolean))].sort() as string[];
  const availableSubDispositions  = [...new Set(allParsed.map(e => e.subDisposition).filter(Boolean))].sort() as string[];

  // Apply remaining in-memory filters (tag, csat, score range, type)
  let entries = [...allParsed];
  if (scopedAgentNames !== null) {
    // scoped role (agent/tl/quality) — DB already filtered, but agentFilter may further narrow
    if (agentFilter) {
      entries = entries.filter(e => e.agentName === agentFilter);
    }
  } else if (agentFilter) {
    entries = entries.filter(e => e.agentName === agentFilter);
  }
  if (tagFilter)    entries = entries.filter(e => (e.disposition || '').toLowerCase() === tagFilter.toLowerCase());
  if (subTagFilter) entries = entries.filter(e => (e.subDisposition || '').toLowerCase() === subTagFilter.toLowerCase());
  if (csatFilter)   entries = entries.filter(e => e.csat === csatFilter);
  if (typeFilter)   entries = entries.filter(e => (e.conversationType || 'agent') === typeFilter);
  entries = entries.filter(e => e.iqs >= minScore && e.iqs <= maxScore);

  const totalFiltered = entries.length;

  // Paginate display entries
  const start = page * PAGE_SIZE;
  const displayEntries = entries.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < totalFiltered;

  // ── Stats over ALL filtered entries (skipped on page-only navigation) ───────
  let agentStats: any[] = [];
  let paramFails: Record<string, number> = {};
  let weeklyParamData: any[] = [];
  let summary: any = null;

  if (!skipStats) {
    const filteredForStats = entries;

    // Agent stats
    const agentMap: Record<string, { total: number; sum: number; scores: number[]; frts: number[]; resolutions: number[]; closures: number[]; b2ts: number[]; csatGood: number; csatTotal: number }> = {};
    for (const e of filteredForStats) {
      const a = e.agentName || 'Unknown';
      if (!agentMap[a]) agentMap[a] = { total: 0, sum: 0, scores: [], frts: [], resolutions: [], closures: [], b2ts: [], csatGood: 0, csatTotal: 0 };
      agentMap[a].total++;
      agentMap[a].sum += e.iqs;
      agentMap[a].scores.push(e.iqs);
      if (typeof e.frt === 'number') agentMap[a].frts.push(e.frt);
      if (typeof e.resolutionTime === 'number') agentMap[a].resolutions.push(e.resolutionTime);
      if (typeof (e as any).closureTime === 'number') agentMap[a].closures.push((e as any).closureTime);
      if (typeof e.botToTeamSecs === 'number') agentMap[a].b2ts.push(e.botToTeamSecs);
      if (e.csat === '5' || e.csat === '3' || e.csat === '1') {
        agentMap[a].csatTotal++;
        if (e.csat === '5') agentMap[a].csatGood++;
      }
    }
    agentStats = Object.entries(agentMap).map(([agent, d]) => ({
      agent,
      chats: d.total,
      avgIqs: Math.round(d.sum / d.total),
      minIqs: Math.min(...d.scores),
      maxIqs: Math.max(...d.scores),
      high: d.scores.filter(s => s >= 90).length,
      atRisk: d.scores.filter(s => s < 70).length,
      avgFrt: d.frts.length ? Math.round(d.frts.reduce((s,n) => s+n, 0) / d.frts.length) : null,
      avgResolution: d.resolutions.length ? Math.round(d.resolutions.reduce((s,n) => s+n, 0) / d.resolutions.length) : null,
      avgClosure: d.closures.length ? Math.round(d.closures.reduce((s,n) => s+n, 0) / d.closures.length) : null,
      avgBotToTeam: d.b2ts.length ? Math.round(d.b2ts.reduce((s,n) => s+n, 0) / d.b2ts.length) : null,
      csatPct: d.csatTotal > 0 ? Math.round(d.csatGood / d.csatTotal * 100) : null,
    })).sort((a, b) => b.avgIqs - a.avgIqs);

    // Param failure rates
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

    // Weekly parameter breakdown
    const weekMap: Record<string, { total: number; fails: Record<string, number> }> = {};
    for (const e of filteredForStats) {
      const key = getWeekKey(e.scoredAt || e.date || '');
      if (!key) continue;
      if (!weekMap[key]) weekMap[key] = { total: 0, fails: {} };
      weekMap[key].total++;
      for (const p of PARAM_ORDER) {
        if ((e.scores || {})[p] === 'No') weekMap[key].fails[p] = (weekMap[key].fails[p] || 0) + 1;
      }
    }
    weeklyParamData = Object.entries(weekMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, d]) => ({
        key,
        label: getWeekLabel(key),
        total: d.total,
        params: Object.fromEntries(PARAM_ORDER.map(p => [p, d.total ? Math.round((d.fails[p] || 0) / d.total * 100) : 0])),
      }));

    // ── Summary metrics ──────────────────────────────────────────────────────
    const botEntries    = filteredForStats.filter(e => e.conversationType === 'bot');
    const agentEntries  = filteredForStats.filter(e => e.conversationType !== 'bot');

    const allCsatScores   = filteredForStats.map(e => csatScore(e.csat)).filter((v): v is number => v !== null);
    const botCsatScores   = botEntries.map(e => csatScore(e.csat)).filter((v): v is number => v !== null);
    const agentCsatScores = agentEntries.map(e => csatScore(e.csat)).filter((v): v is number => v !== null);

    const good   = filteredForStats.filter(e => e.csat === '5').length;
    const cbbBad = filteredForStats.filter(e => e.csat === '3' || e.csat === '1').length;
    const withCsat = filteredForStats.filter(e => ['5','3','1'].includes(e.csat || '')).length;

    const frtValues   = filteredForStats.map(e => e.frt).filter((v): v is number => typeof v === 'number');
    const b2tValues   = filteredForStats.map(e => e.botToTeamSecs).filter((v): v is number => typeof v === 'number');
    const resValues   = filteredForStats.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
    const closeValues = filteredForStats.map(e => (e as any).closureTime).filter((v): v is number => typeof v === 'number');
    const slaOk       = b2tValues.filter(v => v <= SLA_THRESHOLD_SECS).length;

    const iqsEntries    = filteredForStats.filter(e => e.iqs !== undefined);
    const iqsSampleSize = iqsEntries.length;

    summary = {
      totalConvos:   totalFiltered,
      botConvos:     botEntries.length,
      agentConvos:   agentEntries.length,
      overallCsat:   avgOrNull(allCsatScores),
      botCsat:       avgOrNull(botCsatScores),
      agentCsat:     avgOrNull(agentCsatScores),
      good, cbbBad,
      cbbBadPct:     withCsat > 0 ? Math.round((cbbBad / withCsat) * 100) : 0,
      avgFrt:        avgOrNull(frtValues),
      avgBotToTeam:  avgOrNull(b2tValues),
      slaPercent:    b2tValues.length > 0 ? Math.round((slaOk / b2tValues.length) * 100) : null,
      slaThresholdSecs: SLA_THRESHOLD_SECS,
      avgResolution: avgOrNull(resValues),
      avgClosure:    avgOrNull(closeValues),
      avgIqs:        iqsEntries.length ? avg(iqsEntries.map(e => e.iqs)) : null,
      iqsSampleSize,
      samplingPct:   totalFiltered > 0 ? Math.round((iqsSampleSize / totalFiltered) * 100) : 0,
    };
  }

  return NextResponse.json({
    entries: displayEntries,
    ...(skipStats ? {} : { agentStats, paramFails, weeklyParamData, summary }),
    availableAgents,
    availableDispositions,
    availableSubDispositions,
    total: totalFiltered,
    totalStored,
    selfAgentName: selfAgentName || null,
    page,
    pageSize: PAGE_SIZE,
    hasMore,
    _debug: {
      rawRows: totalStored,
      allParsed: allParsed.length,
      afterFilters: totalFiltered,
      agentStatsCount: agentStats.length,
      role: session.user?.role,
      agentFilter,
      selfAgentName: selfAgentName || null,
    },
  });
}
