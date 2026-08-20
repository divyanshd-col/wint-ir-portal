import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getAllScoredCalls, getAgentNamesByQA, getAgentNamesByTL } from '@/lib/robylon/db';
import { getAuthorizedCallDispositions } from '@/lib/qa-disposition';
import { CALL_PARAM_ORDER, CALL_PARAM_NAMES, CALL_WEIGHTS } from '@/lib/call-quality';

const PAGE_SIZE = 50;

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

// DB stores parameters with keys like "Technical", "AllQuestions", etc.
// Normalise to CallParamScore
function normaliseScore(raw: boolean | null | undefined): 'Yes' | 'No' | 'NA' {
  if (raw === true)  return 'Yes';
  if (raw === false) return 'No';
  return 'NA';
}

function normParamsFromDb(params: any): { scores: Record<string, string>; reasoning: Record<string, string> } {
  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  if (!params || typeof params !== 'object') return { scores, reasoning };
  for (const key of CALL_PARAM_ORDER) {
    const entry = params[key];
    if (entry) {
      scores[key]   = normaliseScore(entry.score);
      reasoning[key] = entry.reasoning || '';
    }
  }
  return { scores, reasoning };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const user     = session.user as any;
  const role     = user?.role;
  const userEmail = user?.email || '';
  const url      = new URL(req.url);

  const page        = parseInt(url.searchParams.get('page') || '0', 10);
  const dateFrom    = url.searchParams.get('dateFrom') || '';
  const dateTo      = url.searchParams.get('dateTo') || '';
  const agentFilter = url.searchParams.get('agent') || '';
  const minScore    = url.searchParams.get('minScore') ? parseInt(url.searchParams.get('minScore')!, 10) : undefined;
  const maxScore    = url.searchParams.get('maxScore') ? parseInt(url.searchParams.get('maxScore')!, 10) : undefined;

  // Role-based agent scoping
  let agentNames: string[] | undefined;
  let dispositions: string[] | undefined;

  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();
  const map = config.qaDispositionMap ?? [];
  const qaEntry = map.find(e => e.email.toLowerCase() === userEmail.toLowerCase());

  if (role === 'agent') {
    const selfName = user?.agentName || '';
    agentNames = selfName ? [selfName] : [];
  } else if (role === 'tl') {
    const tlAgents = await getAgentNamesByTL(userEmail);
    agentNames = agentFilter ? tlAgents.filter(n => n === agentFilter) : tlAgents;
  } else if (role === 'quality' || role === 'admin') {
    if (role === 'quality') {
      const qaAgents = await getAgentNamesByQA(userEmail);
      agentNames = agentFilter ? qaAgents.filter(n => n === agentFilter) : qaAgents;
    }

    const userDisps = await getAuthorizedCallDispositions(userEmail, role, config);
    if (userDisps.length > 0) {
      dispositions = userDisps;
    } else if (role === 'quality') {
      return NextResponse.json({ ok: true, entries: [], total: 0, page, hasMore: false, stats: { totalCalls: 0 } });
    }
  }

  let rows: any[] = [];
  let total = 0;
  try {
    ({ rows, total } = await getAllScoredCalls({
      agentName: !agentNames && agentFilter ? agentFilter : undefined,
      agentNames: agentNames,
      dispositions: dispositions,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      minScore,
      maxScore,
      page,
      pageSize: PAGE_SIZE,
    }));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Database error' }, { status: 500 });
  }

  // Normalise rows for the frontend
  const entries = rows.map((r: any) => {
    const { scores, reasoning } = normParamsFromDb(r.parameters);
    const failedParams = CALL_PARAM_ORDER.filter(k => scores[k] === 'No');
    return {
      callId:            r.callId,
      chatId:            r.chatId,
      agentName:         r.agentName || '',
      date:              r.date || '',
      calledAt:          r.calledAt || '',
      durationSeconds:   r.durationSeconds ?? null,
      language:          r.language || '',
      interruptionCount: r.interruptionCount ?? 0,
      deadAirCount:      r.deadAirCount ?? 0,
      iqs:               r.iqs ?? null,
      scores,
      reasoning,
      failedParams,
      modelVersion:      r.modelVersion || '',
      scoredAt:          r.scoredAt || '',
    };
  });

  // Stats
  const iqsList   = entries.map((e: any) => e.iqs).filter((v: any) => v !== null) as number[];
  const avgIqs    = avg(iqsList);
  const avgInterruptions = avg(entries.map((e: any) => e.interruptionCount));
  const avgDeadAir       = avg(entries.map((e: any) => e.deadAirCount));

  // Parameter fail rates
  const paramFailCounts: Record<string, number> = {};
  for (const entry of entries) {
    for (const key of CALL_PARAM_ORDER) {
      if ((entry as any).scores[key] === 'No') {
        paramFailCounts[key] = (paramFailCounts[key] || 0) + 1;
      }
    }
  }
  const paramFailRates: Record<string, number> = {};
  if (entries.length) {
    for (const key of CALL_PARAM_ORDER) {
      paramFailRates[key] = Math.round(((paramFailCounts[key] || 0) / entries.length) * 100);
    }
  }

  return NextResponse.json({
    ok: true,
    entries,
    total,
    page,
    hasMore: (page + 1) * PAGE_SIZE < total,
    stats: {
      totalCalls: total,
      avgIqs,
      avgInterruptions,
      avgDeadAir,
      paramFailRates,
    },
    paramOrder: CALL_PARAM_ORDER,
    paramNames: CALL_PARAM_NAMES,
    paramWeights: CALL_WEIGHTS,
  }, {
    headers: {
      'Cache-Control': 'private, max-age=30',
    }
  });
}
