import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getAllScoredCalls, getAgentNamesByTL, getAgentNamesByQA } from '@/lib/robylon/db';
import { CALL_PARAM_ORDER, CALL_PARAM_NAMES, CALL_WEIGHTS } from '@/lib/call-quality';

const PAGE_SIZE = 50;

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

// DB stores parameters with keys like "Technical", "AllQuestions", etc.
function normaliseScore(raw: any): 'Yes' | 'No' | 'Half' | 'NA' {
  if (raw === true || raw === 'Yes' || raw === 'yes' || raw === 2 || raw === '2' || raw === 'PASS' || raw === 'pass') return 'Yes';
  if (raw === false || raw === 'No' || raw === 'no' || raw === 0 || raw === '0' || raw === 'FAIL' || raw === 'fail') return 'No';
  if (raw === 1 || raw === '1' || raw === 0.5 || raw === '0.5' || raw === 'Half' || raw === 'half' || raw === 'Partial' || raw === 'partial' || raw === 'Part' || raw === 'part') return 'Half';
  return 'NA';
}

function extractReasoning(ev: any): string {
  if (!ev) return '';
  if (typeof ev === 'string') return ev.trim();
  if (Array.isArray(ev)) {
    const parts = ev
      .map(item => {
        if (!item) return '';
        if (typeof item === 'string') return item.trim();
        const text = item.note || item.why || item.reason || item.comment || item.explanation || item.text || item.quote || '';
        return typeof text === 'string' ? text.trim() : String(text);
      })
      .filter(Boolean);
    return parts.join(' • ');
  }
  if (typeof ev === 'object') {
    const text = ev.note || ev.why || ev.reason || ev.comment || ev.explanation || ev.text || ev.quote || '';
    return typeof text === 'string' ? text.trim() : String(text);
  }
  return String(ev).trim();
}

function normParamsFromDb(params: any): { scores: Record<string, string>; reasoning: Record<string, string> } {
  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  if (!params || typeof params !== 'object') return { scores, reasoning };

  // Check if params has v3.1 structure: { scores: {...}, evidence: {...} }
  if (params.scores && typeof params.scores === 'object') {
    const rawScores = params.scores;
    const rawEvidence = params.evidence || params.reasoning || {};
    Object.keys(rawScores).forEach(p => {
      scores[p] = normaliseScore(rawScores[p]);
      const ev = rawEvidence[p] || params[`${p}_reasoning`] || params[`${p}_evidence`];
      reasoning[p] = extractReasoning(ev);
    });
    return { scores, reasoning };
  }

  // Otherwise check standard or legacy key-value pairs
  for (const key of CALL_PARAM_ORDER) {
    const entry = params[key];
    if (entry) {
      if (typeof entry === 'object' && entry !== null) {
        scores[key]   = normaliseScore(entry.score);
        reasoning[key] = entry.reasoning || '';
      } else {
        scores[key] = normaliseScore(entry);
      }
    }
  }

  // Also include any P1..P11 direct keys if present
  ['P1', 'P2', 'P3', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'].forEach(p => {
    if (params[p] !== undefined && !scores[p]) {
      const entry = params[p];
      if (typeof entry === 'object' && entry !== null) {
        scores[p] = normaliseScore(entry.score);
        reasoning[p] = entry.reasoning || '';
      } else {
        scores[p] = normaliseScore(entry);
      }
    }
  });

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
  const limit       = parseInt(url.searchParams.get('limit') || String(PAGE_SIZE), 10);
  const callId      = url.searchParams.get('callId') || '';
  const dateFrom    = url.searchParams.get('dateFrom') || '';
  const dateTo      = url.searchParams.get('dateTo') || '';
  const agentFilter = url.searchParams.get('agent') || '';
  const tagFilter   = url.searchParams.get('disposition') || url.searchParams.get('tag') || '';
  const minScore    = url.searchParams.get('minScore') ? parseInt(url.searchParams.get('minScore')!, 10) : undefined;
  const maxScore    = url.searchParams.get('maxScore') ? parseInt(url.searchParams.get('maxScore')!, 10) : undefined;

  // Role-based agent scoping
  let agentNames: string[] | undefined;
  let availableAgents: string[] = [];
  let dispositions: string[] | undefined;
  let assignedDispositions: string[] | null = null;
  let strictDispositions: string[] | null = null;

  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();

  if (role === 'agent') {
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === userEmail.toLowerCase());
    let selfName = configUser?.agentName || user?.agentName || '';
    if (!selfName && userEmail) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(userEmail).catch(() => null);
      if (dbUser?.name) selfName = dbUser.name;
    }
    if (!selfName) selfName = userEmail.split('@')[0];
    agentNames = selfName ? [selfName] : [];
    availableAgents = agentNames;
  } else if (role === 'tl') {
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === userEmail.toLowerCase());
    let tlAgentName: string = configUser?.agentName || '';
    if (!tlAgentName && userEmail) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(userEmail).catch(() => null);
      if (dbUser?.name) tlAgentName = dbUser.name;
    }
    if (!tlAgentName) tlAgentName = userEmail || '';
    const tlAgents = await getAgentNamesByTL(tlAgentName);
    availableAgents = tlAgents;
    if (agentFilter) {
      agentNames = tlAgents.filter(n =>
        n.toLowerCase() === agentFilter.toLowerCase() ||
        n.toLowerCase().startsWith(agentFilter.toLowerCase() + ' ') ||
        agentFilter.toLowerCase().startsWith(n.toLowerCase() + ' ')
      );
      if (!agentNames.length) agentNames = [agentFilter];
    } else {
      agentNames = tlAgents;
    }
    if (tagFilter) dispositions = [tagFilter];
  } else if (role === 'quality' || role === 'admin') {
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === userEmail.toLowerCase());
    const qaMapEntry = (config.qaDispositionMap ?? []).find(e => e.email.toLowerCase() === userEmail.toLowerCase());
    const userDisps = qaMapEntry?.dispositions ?? configUser?.assignedDispositions;

    if (userDisps?.length) {
      assignedDispositions = userDisps;
      if (role === 'quality') {
        strictDispositions = userDisps;
      }
    }

    if (role === 'quality') {
      const qaAgents = await getAgentNamesByQA(userEmail || '');
      availableAgents = qaAgents;
      if (agentFilter) {
        agentNames = qaAgents.filter(n =>
          n.toLowerCase() === agentFilter.toLowerCase() ||
          n.toLowerCase().startsWith(agentFilter.toLowerCase() + ' ') ||
          agentFilter.toLowerCase().startsWith(n.toLowerCase() + ' ')
        );
        if (!agentNames.length) agentNames = [agentFilter];
      } else {
        agentNames = undefined;
      }
    } else {
      const { query } = await import('@/lib/cx/db');
      const allRows = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active' ORDER BY name ASC`);
      availableAgents = allRows.map(r => r.name);
      if (agentFilter) {
        agentNames = availableAgents.filter(n =>
          n.toLowerCase() === agentFilter.toLowerCase() ||
          n.toLowerCase().startsWith(agentFilter.toLowerCase() + ' ') ||
          agentFilter.toLowerCase().startsWith(n.toLowerCase() + ' ')
        );
        if (!agentNames.length) agentNames = [agentFilter];
      }
    }

    if (strictDispositions) {
      if (tagFilter) {
        if (strictDispositions.includes(tagFilter)) {
          dispositions = [tagFilter];
        } else {
          return NextResponse.json({
            ok: true,
            entries: [],
            total: 0,
            page,
            hasMore: false,
            agents: availableAgents,
            stats: { totalCalls: 0, avgIqs: null, avgInterruptions: null, avgDeadAir: null, paramFailRates: {} },
            ...(assignedDispositions && { assignedDispositions }),
          });
        }
      } else {
        dispositions = strictDispositions;
      }
    } else {
      if (tagFilter) {
        dispositions = [tagFilter];
      } else if (assignedDispositions) {
        dispositions = assignedDispositions;
      }
    }
  }

  let rows: any[] = [];
  let total = 0;
  try {
    ({ rows, total } = await getAllScoredCalls({
      agentName: !agentNames && agentFilter ? agentFilter : undefined,
      agentNames: agentNames,
      callId: callId || undefined,
      dispositions: dispositions,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      minScore,
      maxScore,
      page,
      pageSize: limit,
    }));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Database error' }, { status: 500 });
  }

  // Normalise rows for the frontend
  const entries = rows.map((r: any) => {
    const { scores, reasoning } = normParamsFromDb(r.parameters);
    const failedParams = Object.keys(scores).filter(k => scores[k] === 'No');
    return {
      callId:            r.callId,
      chatId:            r.chatId,
      agentName:         r.agentName || '',
      date:              r.date || '',
      calledAt:          r.calledAt || '',
      disposition:       r.disposition || '',
      subDisposition:    r.subDisposition || '',
      durationSeconds:   r.durationSeconds ?? null,
      language:          r.language || '',
      interruptionCount: r.interruptionCount ?? 0,
      deadAirCount:      r.deadAirCount ?? 0,
      iqs:               r.iqs != null ? parseFloat(r.iqs) : null,
      scores,
      reasoning,
      failedParams,
      verdict:           r.verdict ?? null,
      gates:             r.gates ?? null,
      rawParameters:     r.parameters,
      modelVersion:      r.modelVersion || '',
      scoredAt:          r.scoredAt || '',
    };
  });

  // Calculate aggregates
  const iqsScores = entries.map(e => e.iqs).filter((s): s is number => s !== null);
  const avgIqs = avg(iqsScores);
  const avgInterruptions = entries.length
    ? +(entries.reduce((s, e) => s + e.interruptionCount, 0) / entries.length).toFixed(1)
    : 0;
  const avgDeadAir = entries.length
    ? +(entries.reduce((s, e) => s + e.deadAirCount, 0) / entries.length).toFixed(1)
    : 0;

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
    agents: availableAgents,
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
    ...(assignedDispositions && { assignedDispositions }),
  }, {
    headers: {
      'Cache-Control': 'private, max-age=30',
    }
  });
}
