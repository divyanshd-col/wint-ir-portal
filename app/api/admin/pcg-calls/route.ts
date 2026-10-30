import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { withLogging } from '@/lib/log';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { listUsers } from '@/lib/users';
import { canonicalizePcgRmName, PCG_RM_TELEPHONY_TO_CANONICAL } from '@/lib/pcg/canonical-names';

const ROUTE = 'admin/pcg-calls';

// Canonical 11 PCG Call Quality Parameters across 3 Skill Groups
export const PCG_QUALITY_PARAMETERS = [
  // Group 1: Process Skills — 50%
  {
    id: 'CallOpening',
    num: 1,
    name: 'Call Opening',
    maxWeight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Greeted client respectfully with Sir/Ma\'am, identified self and Wint Wealth, and verified availability to speak.'
  },
  {
    id: 'CallClosing',
    num: 2,
    name: 'Call Closing',
    maxWeight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Thanked client, summarized agreed follow-up next steps, and closed with polite sign-off.'
  },
  {
    id: 'TechnicalLegal',
    num: 3,
    name: 'Technically / Legally Correct',
    maxWeight: 15,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'All product information, yield terms, asset cover, and PMS/AIF disclosures match Wint Knowledge Base with zero return guarantees.'
  },
  {
    id: 'AllQuestions',
    num: 4,
    name: 'All Questions Addressed',
    maxWeight: 10,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Every client question was answered clearly or deferred with confirmed team follow-up timeline.'
  },
  {
    id: 'Expectation',
    num: 5,
    name: 'Expectation Setting',
    maxWeight: 10,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Clear next steps, WhatsApp document timeline, and backend coordination ownership established.'
  },
  {
    id: 'Process',
    num: 6,
    name: 'Process / Pre-check',
    maxWeight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Pre-checked portfolio and relationship history on PCG Finder beforehand; client did not have to repeat context.'
  },
  // Group 2: Communication Skills — 30%
  {
    id: 'Grammar',
    num: 7,
    name: 'Vocabulary / Sentence Structure / Grammar / Pronunciations',
    maxWeight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    defaultQuote: 'Articulate delivery, professional vocabulary, correct pronunciation of fund names and financial terminology.'
  },
  {
    id: 'Fillers',
    num: 8,
    name: 'Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air',
    maxWeight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    defaultQuote: 'Fluent and confident delivery with minimal fillers; all brief lookup pauses were announced clearly.'
  },
  {
    id: 'EnergyTone',
    num: 9,
    name: 'Energy Level, Enthusiasm & Tone Modulation',
    maxWeight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    defaultQuote: 'Attentive, calm, and composed tone suited to HNI wealth management with reassuring modulation.'
  },
  // Group 3: Customer Service Skills — 20%
  {
    id: 'ActiveListening',
    num: 10,
    name: 'Active Listening, Interruptions & Empathy',
    maxWeight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    defaultQuote: 'Listened attentively without speaking over client, acknowledged cash flow preferences with genuine empathy.'
  },
  {
    id: 'Simplifying',
    num: 11,
    name: 'Simplifying Answers',
    maxWeight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    defaultQuote: 'Explained complex financial concepts (hurdle rate, senior secured debt cover, pass-through taxation) in plain language.'
  },
];

// Dynamic PCG Team Leads and team member mappings
export const TL_TEAMS: Record<string, string[]> = {
  Swetha: [
    'Ankita Agarwal',
    'Diya Sharma',
    'Nishtha Veerwani',
    'Sujal Dadwani',
    'Suryansh Sharma',
    'Vaishnavi N J',
    'Vaishnavi Naghat',
    'Vidisha Jaiswal',
    'Vishyata Tulsani',
  ],
  'Saiyam Rastogi': [
    'Ayan Kumar Garg',
    'Gaurav Nautiyal',
    'Mahi Agarwal',
    'Nandini',
    'Rukmini Mundhara',
    'Sahil Joshi',
    'Shruti Sharma',
    'Vishal Kumar Yadav',
  ],
  'Tanisha Mittal': [
    'Antara Chakraborty',
    'Deshna Dugar',
    'Harshita Dhona',
    'Keshvi Suresh Thacker',
    'Maniyar Kriya Jignesh',
    'Nischay Manish Jain',
    'Samskrithi Rao N',
  ],
  'Dheeraj Bhojwani': [
    'Ishaan Kapoor',
    'Paritosh Ashiya',
    'Ramita Kapoor',
    'Sargun Singh',
    'Shivam Kumar Baghel',
    'Shrey Jain',
    'Yaashvi Arora',
  ],
};

function resolveTlName(rmName: string, evalTl?: string | null, customTeamMap?: Record<string, string>): string {
  const cleanRm = rmName.toLowerCase().trim();
  const canonicalClean = canonicalizePcgRmName(rmName).toLowerCase().trim();

  // 1. If person is a TL themselves, they lead their own team
  for (const tl of Object.keys(TL_TEAMS)) {
    if (cleanRm === tl.toLowerCase() || canonicalClean === tl.toLowerCase()) {
      return `Team ${tl}`;
    }
  }

  // 2. Custom team mapping
  if (customTeamMap && (customTeamMap[canonicalClean] || customTeamMap[cleanRm])) {
    return `Team ${customTeamMap[canonicalClean] || customTeamMap[cleanRm]}`;
  }

  // 3. Static TL_TEAMS membership
  for (const [tl, members] of Object.entries(TL_TEAMS)) {
    if (members.some(n => n.toLowerCase() === cleanRm || n.toLowerCase() === canonicalClean)) {
      return `Team ${tl}`;
    }
  }

  // 4. Stored evaluation TL (only if valid and not a system placeholder)
  if (evalTl && evalTl.trim()) {
    const cleanEvalTl = evalTl.replace(/^Team\s+/i, '').trim().toLowerCase();
    if (cleanEvalTl !== 'gokul' && cleanEvalTl !== 'vaishnavi' && cleanEvalTl !== 'triage pool' && cleanEvalTl !== 'pcg' && cleanEvalTl !== 'unknown') {
      return evalTl.startsWith('Team ') ? evalTl : `Team ${evalTl}`;
    }
  }

  return 'PCG Team';
}

function mapRowToCall(r: any, customTeamMap?: Record<string, string>) {
  const rawRm = (r.called_by && r.called_by !== 'Unknown' && r.called_by.trim())
    ? r.called_by.trim()
    : ((r.eval_rm_name && r.eval_rm_name !== 'Unknown' && r.eval_rm_name.trim())
      ? r.eval_rm_name.trim()
      : ((r.agent_name && r.agent_name !== 'Unknown' && r.agent_name.trim())
        ? r.agent_name.trim()
        : 'Unknown RM'));
  const rmName = canonicalizePcgRmName(rawRm);
  const durationSeconds = (r.duration_seconds > 0)
    ? r.duration_seconds
    : (r.raw_payload?.duration ? Math.max(0, parseInt(r.raw_payload.duration, 10) || 0) : 0);
  const isAnswered = (durationSeconds > 0) && r.tag !== 'unanswered' && r.call_type !== 'missed';

  let unansweredBy: 'Customer' | 'RM' | null = null;
  let unansweredReason: string | null = null;
  if (!isAnswered) {
    if (durationSeconds === 0 && r.call_type === 'missed') {
      unansweredBy = 'RM';
      unansweredReason = 'Missed Incoming Call';
    } else if (r.tag && r.tag.toLowerCase().includes('busy')) {
      unansweredBy = 'Customer';
      unansweredReason = 'Customer Busy / Declined';
    } else if (r.tag && r.tag.toLowerCase().includes('unanswered')) {
      unansweredBy = 'Customer';
      unansweredReason = 'Rang Out (No Answer)';
    } else {
      unansweredBy = 'Customer';
      unansweredReason = r.tag || (r.call_type === 'missed' ? 'Missed Call' : 'Unanswered');
    }
  }

  // Determine call category
  const rawCat = r.eval_call_category || r.call_category || '';
  let categoryKey: '13_pitching' | 'upselling' | 'support' = 'support';
  let category = 'General / Support';
  if (rawCat.includes('13') || rawCat.toLowerCase().includes('pitch')) {
    categoryKey = '13_pitching';
    category = '13% Club / Pitching';
  } else if (rawCat.toLowerCase().includes('upsell')) {
    categoryKey = 'upselling';
    category = 'Upselling Calls';
  }

  // Parse parameters if available from evaluation
  let parameters: any[] = [];
  let rawParams = r.parameters;
  if (typeof rawParams === 'string') {
    try { rawParams = JSON.parse(rawParams); } catch { rawParams = []; }
  }
  if (rawParams && Array.isArray(rawParams)) {
    parameters = rawParams.map((p: any) => {
      const expl = p?.explanation || p?.reasoning || p?.quote || '';
      return {
        ...p,
        quote: expl,
        explanation: expl,
        reasoning: expl,
      };
    });
  } else if (rawParams && typeof rawParams === 'object') {
    parameters = Object.entries(rawParams).map(([key, val]: [string, any]) => {
      const expl = typeof val === 'object' ? (val?.explanation || val?.reasoning || val?.quote || '') : '';
      return {
        id: key,
        name: val?.name || key,
        maxScore: val?.maxScore || (key === 'TechnicallyLegal' || key === 'TechnicalLegal' ? 15 : 10),
        earnedScore: val?.earnedScore ?? (val?.status === 'Yes' || val?.score === 'Yes' || val?.rating === 'Yes' ? (val?.maxScore || 10) : 0),
        status: val?.status || val?.rating || val?.score || 'NA',
        quote: expl,
        explanation: expl,
        reasoning: expl,
      };
    });
  }

  // Parse transcript turns if available from evaluation
  let transcriptTurns: any[] = [];
  let rawTurns = r.transcript_turns;
  if (typeof rawTurns === 'string') {
    try { rawTurns = JSON.parse(rawTurns); } catch { rawTurns = []; }
  }
  if (rawTurns && Array.isArray(rawTurns)) {
    transcriptTurns = rawTurns;
  }

  // Real client name resolution (from raw_payload if available, or masked phone number)
  let clientName = 'Investor Client';
  if (r.raw_payload?.name && r.raw_payload.name !== 'Unknown') {
    clientName = r.raw_payload.name;
  } else if (r.phone_number) {
    const p = String(r.phone_number).replace(/^\+91/, '');
    clientName = p.length >= 4 ? `Investor (${p.slice(-4)})` : p;
  }

  const iqsScore = r.iqs_score != null ? Number(r.iqs_score) : null;
  const complianceTripwire = Boolean(r.compliance_tripwire);
  const needsAttention = Boolean(iqsScore !== null && (iqsScore < 85 || complianceTripwire));
  const tlName = resolveTlName(rmName, r.eval_tl_name, customTeamMap);

  const complianceReason = r.compliance_reason || undefined;
  const lowerReason = (complianceReason || '').toLowerCase();

  const g1Fail = complianceTripwire && (
    lowerReason.includes('advice') ||
    lowerReason.includes('tax') ||
    lowerReason.includes('guarantee') ||
    lowerReason.includes('assured') ||
    lowerReason.includes('promise') ||
    lowerReason.includes('fixed')
  );
  const g3Fail = complianceTripwire && (
    lowerReason.includes('identity') ||
    lowerReason.includes('verif') ||
    lowerReason.includes('otp')
  );
  const g2Fail = complianceTripwire && (
    (!g1Fail && !g3Fail) ||
    lowerReason.includes('fabricat') ||
    lowerReason.includes('misrepresent') ||
    lowerReason.includes('ytm') ||
    lowerReason.includes('xirr') ||
    lowerReason.includes('return') ||
    lowerReason.includes('false')
  );

  const gates: any = {
    status: (complianceTripwire ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL',
    reason: complianceReason,
    G1_no_advice: {
      status: g1Fail ? 'fail' : 'pass',
      reasoning: g1Fail ? (complianceReason || '') : '',
    },
    G2_no_fabrication: {
      status: g2Fail ? 'fail' : 'pass',
      reasoning: g2Fail ? (complianceReason || '') : '',
    },
    G3_identity_first: {
      status: g3Fail ? 'fail' : 'pass',
      reasoning: g3Fail ? (complianceReason || '') : '',
    },
  };

  return {
    id: String(r.id),
    callId: r.call_id,
    chatId: null,
    clientName,
    rmName,
    tlName,
    phoneNumber: r.phone_number || '',
    callType: r.call_type || 'outgoing',
    tag: r.tag || null,
    durationSeconds,
    startTime: r.start_time ? new Date(r.start_time).toISOString() : null,
    isAnswered,
    hasRecording: Boolean(r.recording_url),
    category,
    categoryKey,
    secondaryCategories: r.secondary_categories || [],
    allCategories: [categoryKey],
    aiCategoryReasoning: null,
    iqsScore: iqsScore,
    gates,
    needsAttention,
    unansweredBy,
    unansweredReason,
    parameters,
    aiCoachingTip: r.ai_coaching_tip || null,
    transcriptTurns,
    disputeStatus: r.dispute_status || 'none',
    disputeReason: r.dispute_reason || undefined,
    tlOverrideNote: r.tl_override_note || undefined,
  };
}

/**
 * Portal Data Visibility Configuration (Option A):
 * - HIDE_DATA_FOR_NOW: When true, returns clean empty metrics/calls for the portal. Zero database deletion.
 * - When false, serves calls based on whatever date range is requested, allowing batch processing of all historical calls.
 */
export const HIDE_DATA_FOR_NOW = false;


export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  try {
    const { response } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;
  } catch {
    // Permitted in local development
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10')));
  const offset = (page - 1) * limit;

  // Load config & team assignments
  const config = await readConfig().catch(() => null);
  const customTeamMap: Record<string, string> = config?.pcgTeamAssignments || {};

  // Fetch PCG users to get real TLs and canonical RM casing
  const allUsers = await listUsers().catch(() => []);
  const pcgUsers = allUsers.filter(
    (u) => u.platform_domain === 'pcg' || u.platform_domain === 'both' || u.is_super_admin
  );

  // Active TLs from DB
  const dbTlNames = pcgUsers
    .filter((u) => u.role === 'tl' && u.status !== 'disabled')
    .map((u) => u.name);

  // Collect all unique TL names: from DB TLs and from assignments
  const allTlNamesSet = new Set<string>(dbTlNames);
  Object.values(customTeamMap).forEach((tl) => {
    if (tl && tl.trim()) allTlNamesSet.add(tl.trim());
  });

  // Explicitly purge any admin or non-TL names so they NEVER appear as Team Leads
  const nonTlSet = new Set([
    'gokul', 'gokul_admin', 'aahan thaker', 'aahan', 'test-pcg-admin', 'test pcg admin',
    'test-cx-tl', 'test cx tl', 'unknown rm', 'unknown', 'triage pool', 'pcg'
  ]);
  Array.from(allTlNamesSet).forEach((n) => {
    if (nonTlSet.has(n.toLowerCase().trim()) || n.toLowerCase().includes('admin')) {
      allTlNamesSet.delete(n);
    }
  });

  if (allTlNamesSet.size === 0) {
    Object.keys(TL_TEAMS).forEach((tl) => allTlNamesSet.add(tl));
  }

  // Canonical preferred TL order: Swetha, Saiyam Rastogi, Tanisha Mittal, Dheeraj Bhojwani
  const preferredTlOrder = ['Swetha', 'Saiyam Rastogi', 'Tanisha Mittal', 'Dheeraj Bhojwani'];
  const allTlNames = Array.from(allTlNamesSet).sort((a, b) => {
    const idxA = preferredTlOrder.findIndex((p) => p.toLowerCase() === a.toLowerCase());
    const idxB = preferredTlOrder.findIndex((p) => p.toLowerCase() === b.toLowerCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  // Build dynamic mapping of TL Name -> list of RM display names
  const dynamicTlTeams: Record<string, string[]> = {};
  for (const tl of allTlNames) {
    dynamicTlTeams[tl] = [];
  }

  for (const [rmClean, assignedTl] of Object.entries(customTeamMap)) {
    if (!assignedTl) continue;
    const matchedTl = allTlNames.find((t) => t.toLowerCase() === assignedTl.toLowerCase()) || assignedTl;
    if (!dynamicTlTeams[matchedTl]) dynamicTlTeams[matchedTl] = [];

    const dbRm = pcgUsers.find((u) => u.name.trim().toLowerCase() === rmClean.toLowerCase());
    const displayName = dbRm?.name || rmClean.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!dynamicTlTeams[matchedTl].includes(displayName)) {
      dynamicTlTeams[matchedTl].push(displayName);
    }
  }

  for (const tl of allTlNames) {
    if ((!dynamicTlTeams[tl] || dynamicTlTeams[tl].length === 0) && TL_TEAMS[tl]) {
      dynamicTlTeams[tl] = [...TL_TEAMS[tl]];
    }
    if (dynamicTlTeams[tl]) {
      dynamicTlTeams[tl].sort((a, b) => a.localeCompare(b));
    }
  }

  // Option A: If data is hidden for now, return clean empty state without touching database rows
  if (HIDE_DATA_FOR_NOW) {
    return NextResponse.json({
      success: true,
      defaultTl: allTlNames[0] || 'Swetha',
      total: 0,
      page: 1,
      limit,
      totalPages: 1,
      calls: [],
      rms: [],
      rmScorecards: [],
      teamLeads: allTlNames.map((tlName) => ({
        tlName,
        teamSize: (dynamicTlTeams[tlName] || []).length,
        totalCalls: 0,
        connectRate: 0,
        avgScore: 0,
        callsUnder85: 0,
        rms: dynamicTlTeams[tlName] || [],
      })),
      summary: {
        totalCalls: 0,
        answeredCalls: 0,
        unansweredCalls: 0,
        unansweredByRm: 0,
        unansweredByCustomer: 0,
        avgIqs: null,
        totalDurationSeconds: 0,
        activeRmsCount: 0,
        categoryCounts: {
          pitching: 0,
          upselling: 0,
          support: 0,
        },
        unansweredBreakdown: {
          customerRangOut: 0,
          customerBusy: 0,
          rmDroppedEarly: 0,
          rmMissed: 0,
        },
        complianceFlagsCount: 0,
        needsAttentionCount: 0,
      },
    });
  }

  const rmFilter = searchParams.get('rm_name')?.trim();
  const tlFilter = searchParams.get('tl_name')?.trim();
  const callStatusFilter = searchParams.get('status')?.trim(); // 'all' | 'answered' | 'unanswered' | 'needs_attention'
  const categoryFilter = searchParams.get('category')?.trim(); // 'all' | '13_pitching' | 'upselling' | 'support' | 'coaching_available'
  const searchFilter = searchParams.get('search')?.trim();
  const dateFrom = searchParams.get('date_from')?.trim();
  const dateTo = searchParams.get('date_to')?.trim();
  const dateRangeParam = searchParams.get('date_range')?.trim();
  const minIqsParam = searchParams.get('min_iqs')?.trim();
  const maxIqsParam = searchParams.get('max_iqs')?.trim();

  // Compute date range
  // Baseline PCG portal data starts October 17, 2026
  const PCG_DATA_START = new Date('2026-10-17T00:00:00.000Z');

  let startDate: Date;
  let endDate = new Date();

  if (dateFrom && dateTo) {
    startDate = new Date(dateFrom);
    endDate = new Date(`${dateTo}T23:59:59.999Z`);
  } else if (dateRangeParam === '7d') {
    startDate = new Date(Date.now() - 7 * 86400000);
  } else {
    // Default or '30d': Ensure we don't query before PCG baseline Oct 17th, 2026
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    startDate = thirtyDaysAgo < PCG_DATA_START ? PCG_DATA_START : thirtyDaysAgo;
  }



  const startDateIso = startDate.toISOString();
  const endDateIso = endDate.toISOString();

  // 1. Scope / Date Range conditions for overall summary & KPI cards (independent of table filters & pagination)
  const scopeWhereClauses: string[] = ['r.start_time >= $1 AND r.start_time <= $2'];
  const scopeQueryParams: any[] = [startDateIso, endDateIso];

  if (rmFilter && rmFilter !== 'all') {
    const canonical = canonicalizePcgRmName(rmFilter);
    const variations = [rmFilter.toLowerCase(), canonical.toLowerCase()];
    for (const [telName, can] of Object.entries(PCG_RM_TELEPHONY_TO_CANONICAL)) {
      if (can.toLowerCase() === canonical.toLowerCase()) {
        variations.push(telName.toLowerCase());
      }
    }
    const uniqueVars = Array.from(new Set(variations));
    scopeQueryParams.push(uniqueVars);
    scopeWhereClauses.push(
      `LOWER(COALESCE(NULLIF(e.rm_name, 'Unknown'), NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($${scopeQueryParams.length})`
    );
  }

  if (tlFilter && tlFilter !== 'all') {
    const cleanTl = tlFilter.replace(/^Team\s+/i, '').trim().toLowerCase();
    const matchedTlKey = allTlNames.find((t) => t.toLowerCase() === cleanTl);
    const mappedRms = matchedTlKey ? (dynamicTlTeams[matchedTlKey] || []) : [];
    const directRms = Object.entries(customTeamMap)
      .filter(([_, tl]) => tl.toLowerCase() === cleanTl)
      .map(([rm]) => rm.toLowerCase());
    const fallbackRms = (TL_TEAMS[matchedTlKey || ''] || []).map((r) => r.toLowerCase());

    const memberSet = new Set<string>();
    [...mappedRms, ...directRms, ...fallbackRms].forEach((m) => {
      const lower = m.toLowerCase().trim();
      memberSet.add(lower);
      const can = canonicalizePcgRmName(m).toLowerCase().trim();
      memberSet.add(can);
      for (const [telName, c] of Object.entries(PCG_RM_TELEPHONY_TO_CANONICAL)) {
        if (c.toLowerCase().trim() === can) {
          memberSet.add(telName.toLowerCase().trim());
        }
      }
    });

    // Exclude other TLs and Admins so other TLs/Admins are NEVER included in a TL's team calls
    allTlNames.forEach((tl) => {
      memberSet.delete(tl.toLowerCase().trim());
      memberSet.delete(canonicalizePcgRmName(tl).toLowerCase().trim());
    });
    Object.keys(TL_TEAMS).forEach((tl) => {
      memberSet.delete(tl.toLowerCase().trim());
      memberSet.delete(canonicalizePcgRmName(tl).toLowerCase().trim());
    });
    ['aahan thaker', 'aahan', 'gokul', 'vaishnavi', 'unknown rm', 'test-pcg-admin', 'test-cx-tl'].forEach((n) => memberSet.delete(n));

    const allTeamMembers = Array.from(memberSet);

    if (allTeamMembers.length > 0) {
      scopeQueryParams.push(allTeamMembers);
      scopeWhereClauses.push(
        `LOWER(COALESCE(NULLIF(e.rm_name, 'Unknown'), NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($${scopeQueryParams.length})`
      );
    } else {
      scopeWhereClauses.push(`1 = 0`);
    }
  }

  // Summary where clause for period-wide metrics (IQS, total volume, pickup rate)
  const summaryWhereSql = scopeWhereClauses.join(' AND ');
  const summaryParams = [...scopeQueryParams];

  // 2. Table-specific filters (category filter, search, min/max IQS, call status)
  const tableWhereClauses = [...scopeWhereClauses];
  const tableQueryParams = [...scopeQueryParams];

  if (categoryFilter && categoryFilter !== 'all') {
    if (categoryFilter === 'coaching_available') {
      tableWhereClauses.push(`(e.ai_coaching_tip IS NOT NULL AND e.ai_coaching_tip != '')`);
    } else if (categoryFilter === '13_pitching') {
      tableWhereClauses.push(`(e.call_category = '13_pitching' OR r.call_category ILIKE '%13%' OR r.call_category ILIKE '%pitch%')`);
    } else if (categoryFilter === 'upselling') {
      tableWhereClauses.push(`(e.call_category = 'upselling' OR r.call_category ILIKE '%upsell%')`);
    } else if (categoryFilter === 'support') {
      tableWhereClauses.push(`(e.call_category = 'support' OR r.call_category ILIKE '%support%' OR r.call_category ILIKE '%general%')`);
    }
  }

  if (searchFilter) {
    tableQueryParams.push(`%${searchFilter}%`);
    const pIdx = tableQueryParams.length;
    tableWhereClauses.push(
      `(r.call_id ILIKE $${pIdx} OR r.phone_number ILIKE $${pIdx} OR r.called_by ILIKE $${pIdx} OR r.agent_name ILIKE $${pIdx} OR e.rm_name ILIKE $${pIdx})`
    );
  }

  // Min and Max IQS filters
  if (minIqsParam && minIqsParam !== 'all') {
    const minVal = parseFloat(minIqsParam);
    if (!isNaN(minVal)) {
      tableQueryParams.push(minVal);
      tableWhereClauses.push(`e.iqs_score >= $${tableQueryParams.length}`);
    }
  }

  if (maxIqsParam && maxIqsParam !== 'all') {
    const maxVal = parseFloat(maxIqsParam);
    if (!isNaN(maxVal)) {
      tableQueryParams.push(maxVal);
      tableWhereClauses.push(`e.iqs_score <= $${tableQueryParams.length}`);
    }
  }

  // Table status filter
  if (callStatusFilter === 'unanswered') {
    tableWhereClauses.push(`(r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed')`);
  } else if (callStatusFilter === 'needs_attention') {
    tableWhereClauses.push(`(e.compliance_tripwire = true OR (e.iqs_score IS NOT NULL AND e.iqs_score < 85))`);
  } else if (callStatusFilter === 'all') {
    // Show all
  } else {
    // Default: Evaluation table displays connected calls
    tableWhereClauses.push(`(r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))`);
  }

  const tableWhereSql = tableWhereClauses.join(' AND ');

  try {
    const paginatedParams = [...tableQueryParams, limit, offset];

    // Queries to execute concurrently
    const summarySql = `
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))::int AS answered_calls,
        COUNT(*) FILTER (WHERE r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed')::int AS unanswered_calls,
        COUNT(*) FILTER (WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed') AND (r.call_type = 'missed' OR r.tag ILIKE '%drop%' OR r.tag ILIKE '%miss%'))::int AS unanswered_by_rm,
        COUNT(*) FILTER (WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed') AND NOT (r.call_type = 'missed' OR r.tag ILIKE '%drop%' OR r.tag ILIKE '%miss%'))::int AS unanswered_by_customer,
        COALESCE(SUM(r.duration_seconds), 0)::bigint AS total_duration_seconds,
        COUNT(DISTINCT COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM'))::int AS active_rms_count,
        ROUND(AVG(e.iqs_score), 1)::float AS avg_iqs,
        COUNT(*) FILTER (WHERE e.compliance_tripwire = true)::int AS compliance_flags_count,
        COUNT(*) FILTER (WHERE e.compliance_tripwire = true OR (e.iqs_score IS NOT NULL AND e.iqs_score < 85))::int AS needs_attention_count,
        COUNT(*) FILTER (WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed') AND (r.tag ILIKE '%unanswered%' OR r.tag ILIKE '%ring%' OR r.tag ILIKE '%rang%'))::int AS customer_rang_out,
        COUNT(*) FILTER (WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed') AND r.tag ILIKE '%busy%')::int AS customer_busy,
        COUNT(*) FILTER (WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed') AND r.tag ILIKE '%drop%')::int AS rm_dropped_early,
        COUNT(*) FILTER (WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed') AND (r.call_type = 'missed' OR r.tag ILIKE '%miss%'))::int AS rm_missed,
        COUNT(*) FILTER (WHERE e.call_category = '13_pitching' OR r.call_category ILIKE '%13%' OR r.call_category ILIKE '%pitch%')::int AS pitching_count,
        COUNT(*) FILTER (WHERE e.call_category = 'upselling' OR r.call_category ILIKE '%upsell%')::int AS upselling_count,
        COUNT(*) FILTER (WHERE e.call_category = 'support' OR r.call_category ILIKE '%support%' OR r.call_category ILIKE '%general%')::int AS support_count
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE ${summaryWhereSql}
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE ${tableWhereSql}
    `;

    const callsSql = `
      SELECT
        r.id,
        r.call_id,
        r.called_by,
        r.agent_name,
        r.phone_number,
        r.call_type,
        r.tag,
        r.duration_seconds,
        r.start_time,
        r.recording_url,
        r.call_category,
        r.raw_payload,
        e.rm_name AS eval_rm_name,
        e.tl_name AS eval_tl_name,
        e.call_category AS eval_call_category,
        e.secondary_categories,
        e.iqs_score,
        e.parameters,
        e.compliance_tripwire,
        e.compliance_reason,
        e.ai_coaching_tip,
        e.transcript_turns,
        e.dispute_status,
        e.dispute_reason,
        e.tl_override_note
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE ${tableWhereSql}
      ORDER BY
        e.iqs_score IS NOT NULL DESC,
        r.start_time DESC
      LIMIT $${paginatedParams.length - 1} OFFSET $${paginatedParams.length}
    `;

    const rmsSql = `
      SELECT
        COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM') AS name,
        COUNT(*)::int AS count
      FROM pcg_call_recordings r
      WHERE r.start_time >= $1 AND r.start_time <= $2
      GROUP BY 1
      ORDER BY count DESC
    `;

    const windowMs = Math.max(7 * 86400000, endDate.getTime() - startDate.getTime());
    const prevStartDate = new Date(startDate.getTime() - windowMs);
    const prevStartDateIso = prevStartDate.toISOString();

    const rmStatsSql = `
      SELECT
        COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM') AS rm_name,
        COUNT(*) FILTER (WHERE r.start_time >= $2 AND r.start_time <= $3)::int AS total_calls,
        COUNT(*) FILTER (WHERE r.start_time >= $2 AND r.start_time <= $3 AND r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))::int AS answered_calls,
        ROUND(AVG(CASE WHEN r.start_time >= $2 AND r.start_time <= $3 THEN e.iqs_score END), 1)::float AS avg_iqs,
        ROUND(AVG(CASE WHEN r.start_time >= $2 AND r.start_time <= $3 THEN e.iqs_score END), 1)::float AS current_iqs,
        ROUND(AVG(CASE WHEN r.start_time >= $1 AND r.start_time < $2 THEN e.iqs_score END), 1)::float AS prev_iqs,
        ROUND(AVG(CASE WHEN r.start_time >= $2 AND r.start_time <= $3 AND (e.call_category = '13_pitching' OR r.call_category ILIKE '%13%' OR r.call_category ILIKE '%pitch%') THEN e.iqs_score END), 1)::float AS pitch_score,
        ROUND(AVG(CASE WHEN r.start_time >= $2 AND r.start_time <= $3 AND (e.call_category = 'upselling' OR r.call_category ILIKE '%upsell%') THEN e.iqs_score END), 1)::float AS upsell_score,
        ROUND(AVG(CASE WHEN r.start_time >= $2 AND r.start_time <= $3 AND (e.call_category = 'support' OR r.call_category ILIKE '%support%' OR r.call_category ILIKE '%general%') THEN e.iqs_score END), 1)::float AS support_score,
        COUNT(*) FILTER (WHERE r.start_time >= $2 AND r.start_time <= $3 AND e.compliance_tripwire = true)::int AS compliance_flags
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE r.start_time >= $1 AND r.start_time <= $3
      GROUP BY 1
      HAVING COUNT(CASE WHEN r.start_time >= $2 AND r.start_time <= $3 THEN 1 END) > 0
      ORDER BY total_calls DESC
    `;

    const deptSummarySql = `
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))::int AS answered_calls,
        ROUND(AVG(e.iqs_score), 1)::float AS avg_iqs
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE r.start_time >= $1 AND r.start_time <= $2
    `;

    // Query parameter performance per RM and department (skipping NA parameters)
    const rmParamSql = `
      SELECT
        COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM') AS rm_name,
        p->>'id' AS param_id,
        SUM(CASE WHEN p->>'status' != 'NA' AND p->>'status' != 'N/A' THEN (p->>'earnedScore')::numeric ELSE 0 END) AS earned_sum,
        SUM(CASE WHEN p->>'status' != 'NA' AND p->>'status' != 'N/A' THEN (p->>'maxScore')::numeric ELSE 0 END) AS max_sum
      FROM pcg_call_evaluations e
      JOIN pcg_call_recordings r ON r.call_id = e.call_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(e.parameters::jsonb) = 'array' THEN e.parameters::jsonb
          ELSE '[]'::jsonb
        END
      ) AS p
      WHERE r.start_time >= $1 AND r.start_time <= $2
      GROUP BY 1, 2
    `;

    // Query all active and reviewed disputes for this agent / TL scope (independent of table pagination)
    const disputeWhereClauses: string[] = [
      `(e.dispute_status IS NOT NULL AND e.dispute_status != 'none' AND e.dispute_status != '')`
    ];
    const disputeQueryParams: any[] = [];

    if (rmFilter && rmFilter !== 'all') {
      const canonical = canonicalizePcgRmName(rmFilter);
      const variations = [rmFilter.toLowerCase(), canonical.toLowerCase()];
      for (const [telName, can] of Object.entries(PCG_RM_TELEPHONY_TO_CANONICAL)) {
        if (can.toLowerCase() === canonical.toLowerCase()) {
          variations.push(telName.toLowerCase());
        }
      }
      const uniqueVars = Array.from(new Set(variations));
      disputeQueryParams.push(uniqueVars);
      disputeWhereClauses.push(
        `LOWER(COALESCE(NULLIF(e.rm_name, 'Unknown'), NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($${disputeQueryParams.length})`
      );
    } else if (tlFilter && tlFilter !== 'all') {
      const cleanTl = tlFilter.replace(/^Team\s+/i, '').trim().toLowerCase();
      const matchedTlKey = allTlNames.find((t) => t.toLowerCase() === cleanTl);
      const mappedRms = matchedTlKey ? (dynamicTlTeams[matchedTlKey] || []) : [];
      const directRms = Object.entries(customTeamMap)
        .filter(([_, tl]) => tl.toLowerCase() === cleanTl)
        .map(([rm]) => rm.toLowerCase());
      const fallbackRms = (TL_TEAMS[matchedTlKey || ''] || []).map((r) => r.toLowerCase());

      const memberSet = new Set<string>();
      [...mappedRms, ...directRms, ...fallbackRms].forEach((m) => {
        const lower = m.toLowerCase().trim();
        memberSet.add(lower);
        const can = canonicalizePcgRmName(m).toLowerCase().trim();
        memberSet.add(can);
        for (const [telName, c] of Object.entries(PCG_RM_TELEPHONY_TO_CANONICAL)) {
          if (c.toLowerCase().trim() === can) {
            memberSet.add(telName.toLowerCase().trim());
          }
        }
      });

      // Exclude other TLs and Admins
      allTlNames.forEach((tl) => {
        memberSet.delete(tl.toLowerCase().trim());
        memberSet.delete(canonicalizePcgRmName(tl).toLowerCase().trim());
      });
      Object.keys(TL_TEAMS).forEach((tl) => {
        memberSet.delete(tl.toLowerCase().trim());
        memberSet.delete(canonicalizePcgRmName(tl).toLowerCase().trim());
      });
      ['aahan thaker', 'aahan', 'gokul', 'vaishnavi', 'unknown rm', 'test-pcg-admin', 'test-cx-tl'].forEach((n) => memberSet.delete(n));

      const allTeamMembers = Array.from(memberSet);

      if (allTeamMembers.length > 0) {
        disputeQueryParams.push(allTeamMembers);
        disputeWhereClauses.push(
          `LOWER(COALESCE(NULLIF(e.rm_name, 'Unknown'), NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($${disputeQueryParams.length})`
        );
      } else {
        disputeWhereClauses.push(`1 = 0`);
      }
    }

    const disputesSql = `
      SELECT
        r.id,
        r.call_id,
        r.called_by,
        r.agent_name,
        r.phone_number,
        r.call_type,
        r.tag,
        r.duration_seconds,
        r.start_time,
        r.recording_url,
        r.call_category,
        r.raw_payload,
        e.rm_name AS eval_rm_name,
        e.tl_name AS eval_tl_name,
        e.call_category AS eval_call_category,
        e.secondary_categories,
        e.iqs_score,
        e.parameters,
        e.compliance_tripwire,
        e.compliance_reason,
        e.ai_coaching_tip,
        e.transcript_turns,
        e.dispute_status,
        e.dispute_reason,
        e.tl_override_note
      FROM pcg_call_recordings r
      JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE ${disputeWhereClauses.join(' AND ')}
      ORDER BY r.start_time DESC
      LIMIT 100
    `;

    // Execute all queries in parallel for high speed
    const [
      summaryRows,
      countRows,
      callsRows,
      rmsRows,
      rmStatsRows,
      deptSummaryRows,
      rmParamRows,
      disputesRows,
    ] = await Promise.all([
      query(summarySql, summaryParams),
      query(countSql, tableQueryParams),
      query(callsSql, paginatedParams),
      query(rmsSql, [startDateIso, endDateIso]),
      query(rmStatsSql, [prevStartDateIso, startDateIso, endDateIso]),
      query(deptSummarySql, [startDateIso, endDateIso]),
      query(rmParamSql, [startDateIso, endDateIso]),
      query(disputesSql, disputeQueryParams),
    ]);

    const sRow = summaryRows[0] || {};
    const total = countRows[0]?.total || 0;
    const calls = callsRows.map((r) => mapRowToCall(r, customTeamMap));
    const disputes = (disputesRows || []).map((r) => mapRowToCall(r, customTeamMap));

    // Non-RM exclusion set: Admins, TLs, Quality users, placeholders
    const nonRmNames = new Set<string>();
    allUsers.forEach((u) => {
      if (u.role === 'admin' || u.role === 'tl' || u.role === 'quality' || u.is_super_admin) {
        nonRmNames.add(u.name.trim().toLowerCase());
        nonRmNames.add(canonicalizePcgRmName(u.name).toLowerCase());
      }
    });

    allTlNames.forEach((tl) => {
      nonRmNames.add(tl.trim().toLowerCase());
      nonRmNames.add(canonicalizePcgRmName(tl).toLowerCase());
    });
    Object.keys(TL_TEAMS).forEach((tl) => {
      nonRmNames.add(tl.trim().toLowerCase());
      nonRmNames.add(canonicalizePcgRmName(tl).toLowerCase());
    });

    [
      'aahan thaker',
      'aahan',
      'gokul_admin',
      'gokul',
      'swetha jayakumar',
      'unknown rm',
      'test-cx-agent',
      'test cx agent',
      'test pcg admin',
      'test-pcg-admin',
      'test-cx-tl',
      'test cx tl',
    ].forEach((n) => nonRmNames.add(n.toLowerCase()));

    // RM counts
    const rmsCountMap = new Map<string, number>();
    rmsRows.forEach((row: any) => {
      const cName = canonicalizePcgRmName(row.name);
      const cleanLower = cName.toLowerCase();
      const rawLower = (row.name || '').toLowerCase();
      if (
        nonRmNames.has(cleanLower) ||
        nonRmNames.has(rawLower) ||
        cleanLower.includes('admin') ||
        cleanLower === 'unknown rm'
      ) {
        return;
      }
      rmsCountMap.set(cName, (rmsCountMap.get(cName) || 0) + row.count);
    });
    const rms = Array.from(rmsCountMap.entries()).map(([name, count]) => ({
      name,
      count,
    }));

    // Aggregate parameter scores per RM and department-wide
    const rmParamTotals = new Map<string, Record<string, { earned: number; max: number }>>();
    const deptParamTotals: Record<string, { earned: number; max: number }> = {};

    for (const pr of (rmParamRows || [])) {
      if (!pr.param_id) continue;
      const cName = canonicalizePcgRmName(pr.rm_name);

      if (!rmParamTotals.has(cName)) {
        rmParamTotals.set(cName, {});
      }
      const rmParams = rmParamTotals.get(cName)!;
      if (!rmParams[pr.param_id]) {
        rmParams[pr.param_id] = { earned: 0, max: 0 };
      }
      rmParams[pr.param_id].earned += Number(pr.earned_sum || 0);
      rmParams[pr.param_id].max += Number(pr.max_sum || 0);

      if (!deptParamTotals[pr.param_id]) {
        deptParamTotals[pr.param_id] = { earned: 0, max: 0 };
      }
      deptParamTotals[pr.param_id].earned += Number(pr.earned_sum || 0);
      deptParamTotals[pr.param_id].max += Number(pr.max_sum || 0);
    }

    // RM Scorecards calculated from real call records with rolling window comparison
    const scorecardsMap = new Map<string, any>();
    for (const r of rmStatsRows) {
      const canonicalName = canonicalizePcgRmName(r.rm_name);
      const cleanLower = canonicalName.toLowerCase();
      const rawLower = (r.rm_name || '').toLowerCase();

      // Skip non-RMs (Admins, Team Leads, QA users, Unknown)
      if (
        nonRmNames.has(cleanLower) ||
        nonRmNames.has(rawLower) ||
        cleanLower.includes('admin') ||
        cleanLower === 'unknown rm'
      ) {
        continue;
      }

      const totalCalls = r.total_calls || 0;
      const answeredCalls = r.answered_calls || 0;
      const connectRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
      const overallScore = r.avg_iqs != null ? Math.round(r.avg_iqs) : 0;
      const currentIqs = r.current_iqs != null ? Math.round(r.current_iqs) : overallScore;
      const prevIqs = r.prev_iqs != null ? Math.round(r.prev_iqs) : currentIqs;
      const delta2Wk = r.prev_iqs != null
        ? Math.round((currentIqs - prevIqs) * 10) / 10
        : 0;
      const trend: 'improving' | 'declining' | 'stable' =
        delta2Wk > 0 ? 'improving' : (delta2Wk < 0 ? 'declining' : 'stable');

      // Build parameter scores for this RM
      const paramScores: Record<string, number> = {};
      const totals = rmParamTotals.get(canonicalName);
      if (totals) {
        for (const [pId, val] of Object.entries(totals)) {
          if (val.max > 0) {
            paramScores[pId] = Math.round((val.earned / val.max) * 1000) / 10;
          }
        }
      }

      // Find weakest parameter for active coaching focus
      let topWeakness = '—';
      if (overallScore > 0 && overallScore < 85 && Object.keys(paramScores).length > 0) {
        let lowestParam = '';
        let lowestScore = 100;
        for (const [pId, score] of Object.entries(paramScores)) {
          if (score < lowestScore) {
            lowestScore = score;
            lowestParam = pId;
          }
        }
        if (lowestParam) {
          const matchedParam = PCG_QUALITY_PARAMETERS.find((p: any) => p.id === lowestParam);
          topWeakness = matchedParam ? (matchedParam.name.split('/')[0].split(',')[0].trim()) : lowestParam;
        }
      }
      if (topWeakness === '—' && overallScore > 0 && overallScore < 85) {
        topWeakness = 'Technical / Legal disclosures';
      }

      if (scorecardsMap.has(canonicalName)) {
        const existing = scorecardsMap.get(canonicalName);
        const combinedCalls = existing.totalCalls + totalCalls;
        const combinedAnswered = Math.round((existing.connectRate / 100) * existing.totalCalls) + answeredCalls;
        const combinedIqs = (existing.overallScore > 0 && overallScore > 0)
          ? Math.round((existing.overallScore * existing.totalCalls + overallScore * totalCalls) / combinedCalls)
          : (existing.overallScore || overallScore);
        existing.totalCalls = combinedCalls;
        existing.connectRate = combinedCalls > 0 ? Math.round((combinedAnswered / combinedCalls) * 100) : 0;
        existing.overallScore = combinedIqs;
        existing.complianceFlags += (r.compliance_flags || 0);
        existing.parameterScores = { ...existing.parameterScores, ...paramScores };
      } else {
        scorecardsMap.set(canonicalName, {
          rmName: canonicalName,
          totalCalls,
          connectRate,
          pitchScore: r.pitch_score != null ? Math.round(r.pitch_score) : 0,
          upsellScore: r.upsell_score != null ? Math.round(r.upsell_score) : 0,
          supportScore: r.support_score != null ? Math.round(r.support_score) : 0,
          overallScore,
          prev2WkIqs: prevIqs,
          delta2Wk,
          trend,
          complianceFlags: r.compliance_flags || 0,
          topWeakness,
          parameterScores: paramScores,
        });
      }
    }
    const rmScorecards = Array.from(scorecardsMap.values());

    // Team Leads Summaries calculated dynamically from team mappings
    const teamLeads = allTlNames.map((tlName) => {
      const rms = dynamicTlTeams[tlName] || [];
      const rmsLower = new Set(rms.map((r) => canonicalizePcgRmName(r).toLowerCase()));

      const tlRmScorecards = rmScorecards.filter((sc) => rmsLower.has(canonicalizePcgRmName(sc.rmName).toLowerCase()));
      const totalCalls = tlRmScorecards.reduce((sum, sc) => sum + sc.totalCalls, 0);
      const answeredCalls = tlRmScorecards.reduce(
        (sum, sc) => sum + Math.round((sc.connectRate / 100) * sc.totalCalls),
        0
      );
      const connectRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
      const scoredRms = tlRmScorecards.filter((sc) => sc.overallScore > 0);
      const avgScore =
        scoredRms.length > 0
          ? Math.round((scoredRms.reduce((sum, sc) => sum + sc.overallScore, 0) / scoredRms.length) * 10) / 10
          : 0;
      const callsUnder85 = tlRmScorecards.reduce(
        (sum, sc) => sum + (sc.overallScore > 0 && sc.overallScore < 85 ? sc.totalCalls : 0),
        0
      );

      return {
        tlName,
        teamSize: rms.length,
        totalCalls,
        connectRate,
        avgScore,
        callsUnder85,
        rms,
      };
    });

    // Department overall metrics (across all PCG calls in this time window)
    const dRow = (deptSummaryRows && deptSummaryRows[0]) || {};
    const deptTotal = dRow.total_calls || 0;
    const deptAnswered = dRow.answered_calls || 0;
    const departmentStats: {
      totalCalls: number;
      answeredCalls: number;
      pickupRate: number;
      avgIqs: number | null;
      parameterScores: Record<string, number>;
    } = {
      totalCalls: deptTotal,
      answeredCalls: deptAnswered,
      pickupRate: deptTotal > 0 ? Math.round((deptAnswered / deptTotal) * 100) : 0,
      avgIqs: dRow.avg_iqs != null ? dRow.avg_iqs : 0,
      parameterScores: {},
    };

    for (const [pId, val] of Object.entries(deptParamTotals)) {
      if (val.max > 0) {
        departmentStats.parameterScores[pId] = Math.round((val.earned / val.max) * 100);
      }
    }

    const defaultTl = teamLeads[0]?.tlName || allTlNames[0] || 'Swetha';

    return NextResponse.json({
      success: true,
      defaultTl,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      rms,
      rmScorecards,
      teamLeads,
      tlTeams: dynamicTlTeams,
      teamAssignments: customTeamMap,
      departmentStats,
      summary: {
        totalCalls: sRow.total_calls || 0,
        answeredCalls: sRow.answered_calls || 0,
        unansweredCalls: sRow.unanswered_calls || 0,
        unansweredByRm: sRow.unanswered_by_rm || 0,
        unansweredByCustomer: sRow.unanswered_by_customer || 0,
        avgIqs: sRow.avg_iqs != null ? sRow.avg_iqs : null,
        totalDurationSeconds: Number(sRow.total_duration_seconds) || 0,
        activeRmsCount: sRow.active_rms_count || 0,
        categoryCounts: {
          pitching: sRow.pitching_count || 0,
          upselling: sRow.upselling_count || 0,
          support: sRow.support_count || 0,
        },
        unansweredBreakdown: {
          customerRangOut: sRow.customer_rang_out || 0,
          customerBusy: sRow.customer_busy || 0,
          rmDroppedEarly: sRow.rm_dropped_early || 0,
          rmMissed: sRow.rm_missed || 0,
        },
        needsAttentionCount: sRow.needs_attention_count || 0,
        complianceFlagsCount: sRow.compliance_flags_count || 0,
      },
      calls,
      disputes,
    });
  } catch (err: any) {
    console.error('[pcg-calls API] Query error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to query PCG calls from database',
        total: 0,
        page: 1,
        limit,
        totalPages: 1,
        rms: [],
        rmScorecards: [],
        teamLeads: [],
        summary: {
          totalCalls: 0,
          answeredCalls: 0,
          unansweredCalls: 0,
          unansweredByRm: 0,
          unansweredByCustomer: 0,
          avgIqs: null,
          totalDurationSeconds: 0,
          activeRmsCount: 0,
          categoryCounts: { pitching: 0, upselling: 0, support: 0 },
          unansweredBreakdown: { customerRangOut: 0, customerBusy: 0, rmDroppedEarly: 0, rmMissed: 0 },
          needsAttentionCount: 0,
          complianceFlagsCount: 0,
        },
        calls: [],
        disputes: [],
      },
      { status: 500 }
    );
  }
});

export const POST = withLogging(ROUTE, async (req: NextRequest) => {
  try {
    const { response, session } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;

    const body = await req.json();
    const { action, callId, reason, challengedParams, agentName, status, tlOverrideNote, newScore, parameters } = body;

    if (!callId) {
      return NextResponse.json({ error: 'callId is required' }, { status: 400 });
    }

    const config = await readConfig().catch(() => null);
    const customTeamMap: Record<string, string> = config?.pcgTeamAssignments || {};

    // 1. Action: Raise Dispute (Agent or TL)
    if (action === 'raise_dispute') {
      const resolvedAgent = (agentName || (session?.user as any)?.name || 'PCG Agent').trim();
      const mappedTl = resolveTlName(resolvedAgent, undefined, customTeamMap).replace(/^Team\s+/i, '');

      const paramsPrefix = Array.isArray(challengedParams) && challengedParams.length > 0
        ? `Parameters challenged: ${challengedParams.map((p: any) => typeof p === 'string' ? p : p.param || p.name).join(', ')}. `
        : '';
      const finalReason = (paramsPrefix + (reason || 'Agent requested evaluation review on score.')).trim();

      const existing = await query<{ call_id: string }>(
        `SELECT call_id FROM pcg_call_evaluations
         WHERE call_id = $1
            OR call_id LIKE '%' || $1
            OR call_id = (SELECT call_id FROM pcg_call_recordings WHERE call_id = $1 OR call_id LIKE '%' || $1 OR id::text = $1 LIMIT 1)
         LIMIT 1`,
        [callId]
      );

      if (existing.length === 0) {
        const rec = await query<{ call_id: string; phone_number: string; duration_seconds: number }>(
          `SELECT call_id, phone_number, duration_seconds FROM pcg_call_recordings
           WHERE call_id = $1 OR call_id LIKE '%' || $1 OR id::text = $1
           LIMIT 1`,
          [callId]
        );
        const targetCallId = rec[0]?.call_id || callId;
        await query(
          `INSERT INTO pcg_call_evaluations (call_id, rm_name, tl_name, customer_phone, duration_seconds, dispute_status, dispute_reason, scored_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
           ON CONFLICT (call_id) DO UPDATE SET dispute_status = 'pending', dispute_reason = $6, tl_name = COALESCE(NULLIF(pcg_call_evaluations.tl_name, ''), $3), updated_at = NOW()`,
          [targetCallId, resolvedAgent, mappedTl, rec[0]?.phone_number || '', rec[0]?.duration_seconds || 0, finalReason]
        );
      } else {
        await query(
          `UPDATE pcg_call_evaluations
           SET
             dispute_status = 'pending',
             dispute_reason = $1,
             tl_name = COALESCE(NULLIF(tl_name, ''), $2),
             updated_at = NOW()
           WHERE call_id = $3
              OR call_id LIKE '%' || $3
              OR call_id = (SELECT call_id FROM pcg_call_recordings WHERE call_id = $3 OR call_id LIKE '%' || $3 OR id::text = $3 LIMIT 1)`,
          [finalReason, mappedTl, callId]
        );
      }

      return NextResponse.json({
        success: true,
        callId,
        disputeStatus: 'pending',
        tlName: mappedTl,
        disputeReason: finalReason,
      });
    }

    // 2. Action: Resolve Dispute (TL Approve / Reject)
    if (action === 'resolve_dispute') {
      const reviewer = (session?.user as any)?.name || 'Team Leader';
      const finalStatus = status || 'resolved';
      const note = tlOverrideNote || (status === 'resolved' ? 'Dispute reviewed and resolved by TL.' : 'Dispute reviewed by TL.');

      await query(
        `UPDATE pcg_call_evaluations
         SET
           dispute_status = $1,
           tl_override_note = $2,
           iqs_score = COALESCE($3, iqs_score),
           reviewed_by = $4,
           reviewed_at = NOW(),
           updated_at = NOW()
         WHERE call_id = $5
            OR call_id LIKE '%' || $5
            OR call_id = (SELECT call_id FROM pcg_call_recordings WHERE call_id = $5 OR call_id LIKE '%' || $5 OR id::text = $5 LIMIT 1)`,
        [finalStatus, note, newScore != null ? Number(newScore) : null, reviewer, callId]
      );

      return NextResponse.json({ success: true, disputeStatus: finalStatus });
    }

    // 3. Action: Override Parameters (TL Manual Override)
    if (action === 'override_parameters') {
      const reviewer = (session?.user as any)?.name || 'Team Leader';
      const note = tlOverrideNote || 'TL parameter score override.';
      const score = newScore != null ? Number(newScore) : null;

      await query(
        `UPDATE pcg_call_evaluations
         SET
           parameters = COALESCE($1::jsonb, parameters),
           iqs_score = COALESCE($2, iqs_score),
           dispute_status = 'overridden',
           tl_override_note = $3,
           reviewed_by = $4,
           reviewed_at = NOW(),
           updated_at = NOW()
         WHERE call_id = $5
            OR call_id LIKE '%' || $5
            OR call_id = (SELECT call_id FROM pcg_call_recordings WHERE call_id = $5 OR call_id LIKE '%' || $5 OR id::text = $5 LIMIT 1)`,
        [parameters ? JSON.stringify(parameters) : null, score, note, reviewer, callId]
      );

      return NextResponse.json({ success: true, disputeStatus: 'overridden' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('[pcg-calls POST] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
});
