import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';
import { getAllScoredConversations, getScoredConversationsFilterOptions, getAgentNamesByTL, getAgentNamesByQA, type GetScoredConversationsOptions } from '@/lib/robylon/db';
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
  let strictDispositions: string[] | null = null;

  if (['tl', 'quality', 'admin'].includes(role)) {
    const config = await readConfig();
    const configUser = config.users.find((u: any) => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    selfAgentName = configUser?.agentName || '';
    if (!selfAgentName && email) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(email).catch(() => null);
      if (dbUser?.name) selfAgentName = dbUser.name;
    }
    
    const qaMapEntry = (config.qaDispositionMap ?? []).find(e => e.email.toLowerCase() === email.toLowerCase());
    const userDisps = qaMapEntry?.dispositions ?? configUser?.assignedDispositions;

    if (['quality', 'admin'].includes(role) && userDisps?.length) {
      assignedDispositions = userDisps;
      if (email.toLowerCase() !== 'manorathi@wintwealth.com' && email.toLowerCase() !== 'manorathi.t@wintwealth.com') {
        strictDispositions = userDisps;
      }
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
  const baseOpts: GetScoredConversationsOptions = { iqsMax: 79, includeUncertain: true };
  if (role === 'tl' || role === 'agent') {
    baseOpts.excludeNil = true;
  }
  if (scopedAgentNames !== null) {
    if (agentFilter) baseOpts.agentName = agentFilter;
    else baseOpts.agentNames = scopedAgentNames;
  } else if (agentFilter) {
    baseOpts.agentName = agentFilter;
  }
  
  if (strictDispositions) {
    baseOpts.dispositions = strictDispositions;
  } else if (assignedDispositions && !tag) {
    baseOpts.dispositions = assignedDispositions;
  }

  let availableAgents: string[] = [];
  let availableDispositions: string[] = [];
  let availableSubDispositions: string[] = [];
  let dispositionSubMap: Record<string, string[]> = {};

  try {
    const filters = await getScoredConversationsFilterOptions(baseOpts);
    availableAgents = filters.availableAgents;
    availableDispositions = strictDispositions
      ? filters.availableDispositions.filter(d => strictDispositions!.includes(d))
      : filters.availableDispositions;
    availableSubDispositions = filters.availableSubDispositions;
    dispositionSubMap = filters.dispositionSubMap;
  } catch (err: any) {
    console.error('[pending-review] filter options fetch failed:', err.message);
  }

  // Apply filters to get final set
  let finalDisposition = tag || undefined;
  if (strictDispositions && tag) {
    if (strictDispositions.includes(tag)) {
      finalDisposition = tag;
    } else {
      finalDisposition = '__UNAUTHORIZED__';
    }
  }

  const filteredOpts: GetScoredConversationsOptions = {
    ...baseOpts,
    iqsMin: effectiveMin > 0 ? effectiveMin : undefined,
    iqsMax: effectiveMax < 100 ? effectiveMax : 79,
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(finalDisposition && { disposition: finalDisposition, dispositions: undefined }),
    ...(subTag && { subDisposition: subTag }),
  };

  let rows: any[] = [];
  try {
    const res = await getAllScoredConversations({ ...filteredOpts, limit: 1000 });
    rows = res.rows;
  } catch (e: any) {
    return NextResponse.json({ error: 'Database error', detail: e?.message }, { status: 500 });
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
      const k = ALL_DB_KEY_TO_PASCAL[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
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

  const uncertainCount = items.filter(i => !!(i as any).uncertainParameters && !(i as any).qaStatus).length;
  return NextResponse.json({
    items, uncertainCount, availableDispositions, availableSubDispositions, dispositionSubMap,
    availableAgents,
    ...(assignedDispositions && { assignedDispositions }),
  }, {
    headers: {
      'Cache-Control': 'private, max-age=30',
    }
  });
}

export async function PATCH(req: NextRequest) {
  // TL is view-only for chat quality — only QA/admin may mark items reviewed.
  const { session, response } = await requireRole(['admin', 'quality']);
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
