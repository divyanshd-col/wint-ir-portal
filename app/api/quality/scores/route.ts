import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';
import { csatScore } from '@/lib/stats';
import {
  getAllScoredConversations,
  getScoredConversationsFilterOptions,
  getScoredConversationsSummary,
  getScoredConversationsAgentStats,
  getScoredConversationsParamFails,
  getScoredConversationsWeeklyParams,
  getAgentNamesByTL,
  getAgentNamesByQA,
  type GetScoredConversationsOptions
} from '@/lib/robylon/db';
import type { IQSScoreEntry } from '@/lib/quality';

const SLA_THRESHOLD_SECS = 180; // 3 minutes handoff SLA

const PAGE_SIZE = 50;

// ── Convert PostgreSQL row → IQSScoreEntry ────────────────────────────────────
function toIQSScoreEntry(row: any): IQSScoreEntry {
  const rawParams = row.parameters || {};
  const isBotRow = row.conversationType === 'bot' || (!rawParams.__agent_parameters && Boolean(rawParams.__bot_parameters));
  const targetParams = isBotRow
    ? (rawParams.__bot_parameters || rawParams)
    : (rawParams.__agent_parameters || rawParams);

  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  let uncertainParameters: Array<{ parameter: string; question: string }> | undefined;
  let reviewNote: string | undefined;

  for (const [key, val] of Object.entries(targetParams) as [string, any][]) {
    if (key.startsWith('__')) {
      if (key === '__uncertain' && Array.isArray(val) && val.length > 0) uncertainParameters = val;
      if (key === '__review_note' && typeof val === 'string' && val) reviewNote = val;
      continue;
    }
    // Map DB snake_case key → legacy PascalCase; fall back to first-letter capitalize
    const k = ALL_DB_KEY_TO_PASCAL[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
    const sc = val?.score;
    scores[k]    = (sc === true || sc === 1 || sc === 'Yes' || sc === 'pass') ? 'Yes'
      : (sc === 0.5 || sc === 'Half' || sc === 'half') ? 'Half'
      : (sc === false || sc === 0 || sc === 'No' || sc === 'fail') ? 'No'
      : 'NA';
    reasoning[k] = val?.reasoning || val?.comment || '';
  }
  if (!uncertainParameters && Array.isArray(rawParams.__uncertain) && rawParams.__uncertain.length > 0) {
    uncertainParameters = rawParams.__uncertain;
  }
  if (!reviewNote && typeof rawParams.__review_note === 'string' && rawParams.__review_note) {
    reviewNote = rawParams.__review_note;
  }

  const csatStr = row.csat_score ? String(row.csat_score) : '';
  const tags = row.tags || {};

  let botIqsScore: number | null = null;
  let callIqsScore: number | null = null;
  let agentIqsScore: number | null = row.iqs != null ? Number(row.iqs) : null;
  if (rawParams?.__scores) {
    if (rawParams.__scores.agent_iqs != null) agentIqsScore = parseFloat(rawParams.__scores.agent_iqs);
    if (rawParams.__scores.bot_iqs != null) botIqsScore = parseFloat(rawParams.__scores.bot_iqs);
    if (rawParams.__scores.call_iqs != null) callIqsScore = parseFloat(rawParams.__scores.call_iqs);
  }

  return {
    id:              `${row.scoredAt}-${row.chatId}`,
    chatId:          row.chatId,
    scoredAt:        row.scoredAt,
    agentName:       row.agentName || '',
    date:            row.date ? (row.date instanceof Date ? row.date.toISOString().slice(0, 10) : typeof row.date === 'string' && row.date.includes('T') ? row.date.slice(0, 10) : String(row.date).slice(0, 10)) : '',
    iqs:             agentIqsScore,
    botIqsScore:     botIqsScore ?? undefined,
    callIqsScore:    callIqsScore ?? undefined,
    csat:            csatStr,
    scores:          scores as Record<string, any>,
    reasoning,
    parameters:      rawParams,
    summary:         '',
    provider:        row.modelVersion?.includes('gemini') ? 'gemini' : 'claude',
    model:           row.modelVersion || '',
    conversationType: row.conversationType || 'agent',
    frt:             row.frt ?? undefined,
    botToTeamSecs:   row.botToTeamSecs ?? undefined,
    resolutionTime:  row.resolutionTime ?? undefined,
    disposition:     tags.disposition || '',
    subDisposition:  tags.sub_disposition || '',
    mobileNumber:    row.mobileNumber || undefined,
    ...(uncertainParameters && { uncertainParameters }),
    ...(reviewNote && { reviewNote }),
    // "Edited by" indicator — populated from dedicated DB columns set by the override route
    ...(row.reviewedBy  && { updatedBy: row.reviewedBy }),
    ...(row.reviewedAt  && { updatedAt: new Date(row.reviewedAt).toISOString() }),
  } as IQSScoreEntry;
}

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const page          = Math.max(0, parseInt(searchParams.get('page') || '0'));
  const limitParam    = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '50', 10);
  const requestedPageSize = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
  const skipStats     = searchParams.get('skipStats') === '1';
  const agentFilter   = searchParams.get('agent') || '';
  const minScore      = searchParams.get('minScore') ? parseInt(searchParams.get('minScore')!) : 0;
  const maxScore      = searchParams.get('maxScore') ? parseInt(searchParams.get('maxScore')!) : 100;
  const tagFilter     = searchParams.get('tag') || '';
  const subTagFilter  = searchParams.get('subTag') || '';
  const csatFilter    = searchParams.get('csat') || '';
  const dateFrom      = searchParams.get('dateFrom') || '';
  const dateTo        = searchParams.get('dateTo') || '';
  const typeFilter     = searchParams.get('type') || '';
  const chatIdSearch   = searchParams.get('chatId') || '';
  const minUserMsgsRaw = searchParams.get('minUserMsgs');
  const minUserMessages = minUserMsgsRaw ? parseInt(minUserMsgsRaw, 10) : undefined;

  const role = session.user?.role;

  // Resolve the portal user's agentName for scoped roles
  let selfAgentName = '';
  let scopedAgentNames: string[] | null = null; // null = no scope restriction

  let assignedDispositions: string[] | null = null;
  let strictDispositions: string[] | null = null;

  if (role === 'agent' || role === 'tl' || role === 'quality' || role === 'admin') {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig();
    const email = session.user?.email || '';
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    selfAgentName = configUser?.agentName || '';
    if (!selfAgentName && email) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(email).catch(() => null);
      if (dbUser?.name) {
        selfAgentName = dbUser.name;
      }
    }
    
    const qaMapEntry = (config.qaDispositionMap ?? []).find(e => e.email.toLowerCase() === email.toLowerCase());
    const userDisps = qaMapEntry?.dispositions ?? configUser?.assignedDispositions;

    if ((role === 'quality' || role === 'admin') && userDisps?.length) {
      assignedDispositions = userDisps;
      if (role === 'quality') {
        strictDispositions = userDisps;
      }
    }
  }

  if (role === 'agent' && selfAgentName) {
    const { query: dbQuery } = await import('@/lib/cx/db');
    const matchedRows = await dbQuery<{ name: string }>(
      `SELECT name FROM agents WHERE name = $1 OR name ILIKE $1 || ' %' OR $1 ILIKE name || ' %'`,
      [selfAgentName]
    );
    scopedAgentNames = matchedRows.length ? matchedRows.map(r => r.name) : [selfAgentName];
  } else if (role === 'tl' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByTL(selfAgentName);
  } else if (role === 'quality' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByQA(selfAgentName);
  }

  const dbOpts: GetScoredConversationsOptions = {};
  if (role === 'agent' || role === 'tl') {
    dbOpts.excludeNil = true;
  }
  if (!chatIdSearch) {
    if (dateFrom) dbOpts.dateFrom = dateFrom;
    if (dateTo)   dbOpts.dateTo   = dateTo;
    
    if (strictDispositions) {
      if (tagFilter) {
        if (strictDispositions.includes(tagFilter)) {
          dbOpts.disposition = tagFilter;
        } else {
          dbOpts.disposition = '__UNAUTHORIZED__';
        }
      } else {
        dbOpts.dispositions = strictDispositions;
      }
    } else {
      if (tagFilter)     dbOpts.disposition     = tagFilter;
      else if (assignedDispositions) dbOpts.dispositions = assignedDispositions; // soft default for QA
    }
    
    if (subTagFilter)  dbOpts.subDisposition  = subTagFilter;
    if (csatFilter)    dbOpts.csat            = csatFilter;
    if (typeFilter)    dbOpts.conversationType = typeFilter;
  }
  if (minUserMessages && minUserMessages > 0) dbOpts.minUserMessages = minUserMessages;
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

  // Add search/score filters and pagination to dbOpts
  if (chatIdSearch) dbOpts.chatIdSearch = chatIdSearch;
  if (minScore)      dbOpts.iqsMin      = minScore;
  if (maxScore !== 100) dbOpts.iqsMax   = maxScore;
  dbOpts.page = page;
  dbOpts.pageSize = requestedPageSize;

  let displayEntries: IQSScoreEntry[] = [];
  let totalFiltered = 0;

  try {
    const { rows, total } = await getAllScoredConversations(dbOpts);
    totalFiltered = total;
    displayEntries = rows.map(row => {
      try { return toIQSScoreEntry(row); } catch (e: any) {
        console.error('[quality/scores] toIQSScoreEntry failed:', e?.message, JSON.stringify(row).slice(0, 200));
        return null;
      }
    }).filter(Boolean) as IQSScoreEntry[];
  } catch (dbErr: any) {
    console.error('[quality/scores] DB fetch failed:', dbErr?.message ?? dbErr);
    return NextResponse.json({ error: 'Database error', detail: dbErr?.message }, { status: 500 });
  }

  const start = page * PAGE_SIZE;
  const hasMore = start + PAGE_SIZE < totalFiltered;

  // Derive available filter values using a cheap SELECT DISTINCT query
  const filterOpts: GetScoredConversationsOptions = {};
  if (dateFrom) filterOpts.dateFrom = dateFrom;
  if (dateTo) filterOpts.dateTo = dateTo;
  if (scopedAgentNames) {
    if (agentFilter) filterOpts.agentName = agentFilter;
    else filterOpts.agentNames = scopedAgentNames;
  } else if (agentFilter) {
    filterOpts.agentName = agentFilter;
  }

  let availableAgents: string[] = [];
  let availableDispositions: string[] = [];
  let availableSubDispositions: string[] = [];
  let dispositionSubMap: Record<string, string[]> = {};

  try {
    const filters = await getScoredConversationsFilterOptions(filterOpts);
    availableAgents = filters.availableAgents;
    availableDispositions = strictDispositions
      ? filters.availableDispositions.filter(d => strictDispositions!.includes(d))
      : filters.availableDispositions;
    availableSubDispositions = filters.availableSubDispositions;
    dispositionSubMap = filters.dispositionSubMap;
  } catch (err: any) {
    console.error('[quality/scores] DB filter options fetch failed:', err?.message);
  }

  // Stats over ALL filtered entries calculated via SQL aggregates
  let summary: any = null;
  let agentStats: any[] = [];
  let paramFails: Record<string, number> = {};
  let weeklyParamData: any[] = [];

  try {
    if (!skipStats) {
      const statsOpts = { ...dbOpts, page: undefined, pageSize: undefined, limit: undefined };
      summary = await getScoredConversationsSummary(statsOpts);
      [agentStats, paramFails, weeklyParamData] = await Promise.all([
        getScoredConversationsAgentStats(statsOpts),
        getScoredConversationsParamFails(statsOpts),
        getScoredConversationsWeeklyParams(statsOpts),
      ]);
    }
  } catch (statsErr: any) {
    console.error('[quality/scores] Stats computation failed:', statsErr?.message);
  }

  return NextResponse.json({
    entries: displayEntries,
    summary,  // always included so filter bar reflects active filters
    ...(skipStats ? {} : { agentStats, paramFails, weeklyParamData }),
    availableAgents,
    availableDispositions,
    availableSubDispositions,
    dispositionSubMap,
    total: totalFiltered,
    totalStored: totalFiltered,
    selfAgentName: selfAgentName || null,
    ...(assignedDispositions && { assignedDispositions }),
    page,
    pageSize: PAGE_SIZE,
    hasMore,
    _debug: {
      rawRows: totalFiltered,
      allParsed: displayEntries.length,
      afterFilters: totalFiltered,
      agentStatsCount: agentStats.length,
      role: session.user?.role,
      agentFilter,
      selfAgentName: selfAgentName || null,
    },
  }, {
    headers: {
      'Cache-Control': 'private, max-age=30',
    }
  });
}
