import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getAllScoredCalls, getAgentNamesByTL, getAgentNamesByQA } from '@/lib/robylon/db';
import { CALL_PARAM_ORDER } from '@/lib/call-quality';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';

function normaliseScore(raw: boolean | null | undefined): 'Yes' | 'No' | 'NA' {
  if (raw === true)  return 'Yes';
  if (raw === false) return 'No';
  return 'NA';
}

function normParams(params: any): { scores: Record<string, string>; reasoning: Record<string, string> } {
  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  if (!params || typeof params !== 'object') return { scores, reasoning };
  for (const key of CALL_PARAM_ORDER) {
    const entry = params[key];
    if (entry) {
      scores[key]    = normaliseScore(entry.score);
      reasoning[key] = entry.reasoning || '';
    }
  }
  return { scores, reasoning };
}

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const role  = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  // Resolve scoped agent names and assigned call dispositions
  let scopedAgentNames: string[] | null = null;
  let assignedCallDispositions: string[] | null = null;

  if (role === 'tl') {
    const config = await readConfig();
    const configUser = config.users.find((u: any) => (u.email || u.username) === email);
    const selfAgentName = configUser?.agentName || '';
    if (selfAgentName) scopedAgentNames = await getAgentNamesByTL(selfAgentName);
  } else if (role === 'quality' || role === 'admin') {
    const config = await readConfig();
    const configUser = config.users.find((u: any) => (u.email || u.username) === email);
    const selfAgentName = configUser?.agentName || '';
    if (selfAgentName && role === 'quality') scopedAgentNames = await getAgentNamesByQA(selfAgentName);
    
    const map = config.qaDispositionMap ?? [];
    const qaEntry = map.find(e => e.email.toLowerCase() === email.toLowerCase());

    if ((role === 'quality' || qaEntry) && (configUser as any)?.assignedCallDispositions?.length) {
      if (email.toLowerCase() !== 'manorathi@wintwealth.com' && email.toLowerCase() !== 'manorathi.t@wintwealth.com') {
        assignedCallDispositions = (configUser as any).assignedCallDispositions as string[];
      }
    }
  }

  const url           = new URL(req.url);
  const dateFrom      = url.searchParams.get('dateFrom') || '';
  const dateTo        = url.searchParams.get('dateTo') || '';
  const agentFilter   = url.searchParams.get('agent') || '';
  const dispositionFilter = url.searchParams.get('disposition') || '';
  const minScore      = url.searchParams.get('minScore') ? parseInt(url.searchParams.get('minScore')!, 10) : undefined;
  const maxScore      = url.searchParams.get('maxScore') ? parseInt(url.searchParams.get('maxScore')!, 10) : undefined;

  // Build agent name opts — admin sees all, tl/qa are scoped
  let agentNames: string[] | undefined;
  if (scopedAgentNames !== null) {
    agentNames = agentFilter
      ? scopedAgentNames.filter(n => n === agentFilter)
      : scopedAgentNames;
  } else if (agentFilter) {
    agentNames = undefined; // admin with specific filter — pass as agentName below
  }

  // QA disposition scoping: apply assigned dispositions as default when no explicit filter
  const effectiveDispositions = assignedCallDispositions && !dispositionFilter
    ? assignedCallDispositions
    : dispositionFilter ? [dispositionFilter] : undefined;

  const baseOpts = {
    agentName:      (!scopedAgentNames && agentFilter) ? agentFilter : undefined,
    agentNames:     agentNames,
    dateFrom:       dateFrom || undefined,
    dateTo:         dateTo || undefined,
    minScore,
    maxScore,
    dispositions:   effectiveDispositions,
    unreviewedOnly: false,
  };

  // Fetch ALL (for available agents list) then unreviewed separately
  let allRows: any[] = [];
  let unreviewedRows: any[] = [];
  try {
    ({ rows: allRows } = await getAllScoredCalls({ ...baseOpts, pageSize: 1000 }));
    ({ rows: unreviewedRows } = await getAllScoredCalls({ ...baseOpts, unreviewedOnly: true, pageSize: 1000 }));
  } catch (e: any) {
    return NextResponse.json({ error: 'Database error', detail: e?.message }, { status: 500 });
  }

  const availableAgents = [...new Set(allRows.map((r: any) => r.agentName).filter(Boolean))].sort() as string[];

  const mapRow = (r: any) => {
    const { scores, reasoning } = normParams(r.parameters);
    const failedParams = CALL_PARAM_ORDER.filter(k => scores[k] === 'No');
    const qaStatus = r.reviewedBy
      ? { reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, reviewNote: r.reviewNote || '' }
      : null;
    return {
      callId:            r.callId,
      chatId:            r.chatId || null,
      agentName:         r.agentName || '',
      date:              r.date ? String(r.date).slice(0, 10) : '',
      calledAt:          r.calledAt || '',
      durationSeconds:   r.durationSeconds ?? null,
      language:          r.language || '',
      interruptionCount: r.interruptionCount ?? 0,
      deadAirCount:      r.deadAirCount ?? 0,
      iqs:               r.iqs ?? null,
      scores,
      reasoning,
      failedParams,
      scoredAt:          r.scoredAt || '',
      qaStatus,
    };
  };

  const items         = unreviewedRows.map(mapRow);
  const reviewedItems = allRows.filter((r: any) => !!r.reviewedBy).map(mapRow);

  return NextResponse.json({
    items,
    reviewedItems,
    availableAgents,
    assignedCallDispositions: assignedCallDispositions || [],
  });
}

export async function PATCH(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const role  = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  const body = await req.json();
  const { callId, chatId, reviewNote } = body;

  if (!callId && !chatId) return NextResponse.json({ error: 'callId or chatId required' }, { status: 400 });

  try {
    if (callId) {
      // Per-call review: mark the call recording itself
      await query(
        `UPDATE call_recordings
         SET reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE id = $1`,
        [String(callId), email, reviewNote || ''],
      );
      // Also mark the chat-level iqs_scores row so the "reviewed" state is consistent across tabs
      const chatRows = await query<{ chat_id: string }>(
        `SELECT chat_id FROM call_recordings WHERE id = $1`,
        [String(callId)],
      );
      if (chatRows.length && chatRows[0].chat_id) {
        await query(
          `UPDATE iqs_scores
           SET reviewed_by = $2, reviewed_at = NOW(), review_note = $3
           WHERE chat_id = $1`,
          [chatRows[0].chat_id, email, reviewNote || ''],
        );
      }
    } else {
      // Legacy: mark by chatId
      await query(
        `UPDATE iqs_scores
         SET reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE chat_id = $1`,
        [String(chatId), email, reviewNote || ''],
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: 'DB error', detail: e?.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
