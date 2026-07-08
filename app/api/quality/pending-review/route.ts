import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { DB_KEY_TO_LEGACY } from '@/lib/param-keys';
import { getAllScoredConversations, getAgentNamesByTL, getAgentNamesByQA } from '@/lib/robylon/db';
import { storeGetIQSFlags } from '@/lib/store';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const role  = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  let selfAgentName = '';
  let scopedAgentNames: string[] | null = null;
  let assignedDispositions: string[] | null = null;

  if (['tl', 'quality'].includes(role)) {
    const config = await readConfig();
    const configUser = config.users.find((u: any) => (u.email || u.username) === email);
    selfAgentName = configUser?.agentName || '';
    if (role === 'quality' && configUser?.assignedDispositions?.length) {
      assignedDispositions = configUser.assignedDispositions;
    }
  }

  if (role === 'tl' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByTL(selfAgentName);
  } else if (role === 'quality' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByQA(selfAgentName);
  }

  // Parse filter params
  const url = new URL(req.url);
  const agentFilter  = url.searchParams.get('agent') || '';
  const dateFrom     = url.searchParams.get('dateFrom') || '';
  const dateTo       = url.searchParams.get('dateTo') || '';
  const tag          = url.searchParams.get('tag') || '';
  const subTag       = url.searchParams.get('subTag') || '';
  const minScoreRaw  = parseInt(url.searchParams.get('minScore') ?? '', 10);
  const maxScoreRaw  = parseInt(url.searchParams.get('maxScore') ?? '', 10);
  const minScore     = isNaN(minScoreRaw) ? 0  : Math.max(0,   Math.min(100, minScoreRaw));
  const maxScore     = isNaN(maxScoreRaw) ? 79 : Math.max(0,   Math.min(100, maxScoreRaw));
  // Clamp so an inverted range doesn't silently return zero results
  const effectiveMin = Math.min(minScore, maxScore);
  const effectiveMax = Math.max(minScore, maxScore);

  // Base opts shared by all queries
  const baseOpts: Parameters<typeof getAllScoredConversations>[1] = { iqsMax: 79, includeUncertain: true };
  if (scopedAgentNames !== null) {
    if (agentFilter) baseOpts.agentName = agentFilter;
    else baseOpts.agentNames = scopedAgentNames;
  } else if (agentFilter) {
    baseOpts.agentName = agentFilter;
  }
  // Soft disposition default for QA: pre-filter unless QA explicitly overrides with a tag
  if (assignedDispositions && !tag) baseOpts.dispositions = assignedDispositions;

  // Fetch unfiltered set to build dropdown options
  let allRows: any[] = [];
  try {
    allRows = await getAllScoredConversations(0, baseOpts);
  } catch (e: any) {
    return NextResponse.json({ error: 'Database error', detail: e?.message }, { status: 500 });
  }

  // Build available filter options from full unfiltered set
  const availableDispositions = [...new Set(allRows.map((r: any) => r.disposition).filter(Boolean))].sort() as string[];
  const dispositionSubMap: Record<string, string[]> = {};
  for (const r of allRows) {
    if (!r.disposition) continue;
    if (!dispositionSubMap[r.disposition]) dispositionSubMap[r.disposition] = [];
    if (r.subDisposition && !dispositionSubMap[r.disposition].includes(r.subDisposition)) {
      dispositionSubMap[r.disposition].push(r.subDisposition);
    }
  }
  for (const k of Object.keys(dispositionSubMap)) dispositionSubMap[k].sort();
  const availableSubDispositions = [...new Set(allRows.map((r: any) => r.subDisposition).filter(Boolean))].sort() as string[];

  // Apply filters to get final set
  const filteredOpts: Parameters<typeof getAllScoredConversations>[1] = {
    ...baseOpts,
    iqsMin: effectiveMin > 0 ? effectiveMin : undefined,
    iqsMax: effectiveMax < 100 ? effectiveMax : 79,
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(tag && { disposition: tag, dispositions: undefined }), // user override clears the default
    ...(subTag && { subDisposition: subTag }),
  };

  let rows: any[] = [];
  if (dateFrom || dateTo || tag || subTag || effectiveMin > 0 || effectiveMax < 79 || agentFilter) {
    try {
      rows = await getAllScoredConversations(0, filteredOpts);
    } catch (e: any) {
      return NextResponse.json({ error: 'Database error', detail: e?.message }, { status: 500 });
    }
  } else {
    rows = allRows;
  }

  // Build flag map: chatId → pending flag
  const flagsByChat: Record<string, any> = {};
  try {
    const flagStrings = await storeGetIQSFlags();
    for (const s of flagStrings) {
      try {
        const f = JSON.parse(s);
        if (f.chatId) flagsByChat[String(f.chatId)] = f;
      } catch {}
    }
  } catch {}

  const items = rows.map((row: any) => {
    const parameters = row.parameters || {};
    const scores: Record<string, string> = {};
    const reasoning: Record<string, string> = {};
    let uncertain: Array<{ parameter: string; question: string }> | undefined;

    for (const [key, val] of Object.entries(parameters) as [string, any][]) {
      if (key === '__uncertain') {
        if (Array.isArray(val) && val.length > 0) uncertain = val;
        continue;
      }
      const k = DB_KEY_TO_LEGACY[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
      scores[k]    = val?.score === true ? 'Yes' : val?.score === false ? 'No' : 'NA';
      reasoning[k] = val?.reasoning || '';
    }

    const qaStatus = row.reviewedBy
      ? { reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt, reviewNote: row.reviewNote || '' }
      : null;

    return {
      chatId: String(row.chatId),
      agentName: row.agentName || '',
      iqs: row.iqs,
      scoredAt: row.scoredAt,
      date: row.date ? String(row.date).slice(0, 10) : '',
      mobileNumber: row.mobileNumber || '',
      disposition: row.disposition || '',
      subDisposition: row.subDisposition || '',
      flag: flagsByChat[String(row.chatId)] || null,
      qaStatus,
      scores,
      reasoning,
      ...(uncertain && { uncertainParameters: uncertain }),
    };
  });

  const availableAgents = [...new Set(allRows.map((r: any) => r.agentName).filter(Boolean))].sort() as string[];
  const uncertainCount = items.filter(i => !!(i as any).uncertainParameters && !(i as any).qaStatus).length;
  return NextResponse.json({
    items, uncertainCount, availableDispositions, availableSubDispositions, dispositionSubMap,
    availableAgents,
    ...(assignedDispositions && { assignedDispositions }),
  });
}

export async function PATCH(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const role = (session.user as any)?.role;

  const { chatId, reviewNote } = await req.json();
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  try {
    await query(
      `UPDATE iqs_scores
       SET reviewed_by = $2, reviewed_at = NOW(), review_note = $3
       WHERE chat_id = $1`,
      [String(chatId), (session.user as any)?.email || '', reviewNote || ''],
    );
  } catch (e: any) {
    return NextResponse.json({ error: 'DB error', detail: e?.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
