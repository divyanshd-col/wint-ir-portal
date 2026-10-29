import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { withLogging } from '@/lib/log';
import { query } from '@/lib/cx/db';

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

// TL to RM mappings
export const TL_TEAMS: Record<string, string[]> = {
  Gokul: [
    'Dheeraj Bhojwani',
    'Ramita Kapoor',
    'Aahan Thaker',
    'Aahan',
    'Paritosh Ashiya',
    'Sahil Joshi',
    'Yaashvi Arora',
    'Samskriti Rao',
    'Gaurav Nautiyal',
    'Dhanush',
    'Samir',
    'SM Naik',
    'Nandani',
    'Shruti',
    'Sravanthi',
    'Togarana Akash',
  ],
  Vaishnavi: [
    'Antara Chakrabarty',
    'Mahek Bihani',
    'Kriya Maniyar',
    'Vaishnavi',
    'Shrey Jain',
    'Ishaan Kapoor',
    'Harshita Dhona',
    'Diya Sharma',
    'Richa Mishra',
    'Sreeram',
    'Saiyam Rastogi',
    'Sujal Dadwani',
    'Aravind',
    'Swati Singh',
    'Deshna Dugar',
    'Renessa',
    'Sahil Goyal',
    'Shreya Mundada',
    'Swetha Jayakumar',
    'Tanisha Mittal',
    'Vishal Yadav',
  ],
};

function resolveTlName(rmName: string, evalTl?: string | null): string {
  if (evalTl && evalTl.trim()) return evalTl;
  const cleanRm = rmName.toLowerCase();
  if (TL_TEAMS.Gokul.some(n => n.toLowerCase() === cleanRm)) return 'Team Gokul';
  if (TL_TEAMS.Vaishnavi.some(n => n.toLowerCase() === cleanRm)) return 'Team Vaishnavi';
  return 'PCG Team';
}

function mapRowToCall(r: any) {
  const rmName = (r.eval_rm_name && r.eval_rm_name !== 'Unknown' ? r.eval_rm_name : null)
    || (r.called_by && r.called_by !== 'Unknown' ? r.called_by : null)
    || (r.agent_name && r.agent_name !== 'Unknown' ? r.agent_name : null)
    || 'Unknown RM';
  const isAnswered = (r.duration_seconds > 0) && r.tag !== 'unanswered' && r.call_type !== 'missed';

  let unansweredBy: 'Customer' | 'RM' | null = null;
  let unansweredReason: string | null = null;
  if (!isAnswered) {
    if (r.duration_seconds === 0 && r.call_type === 'missed') {
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
  const tlName = resolveTlName(rmName, r.eval_tl_name);

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
    durationSeconds: r.duration_seconds || 0,
    startTime: r.start_time ? new Date(r.start_time).toISOString() : null,
    isAnswered,
    hasRecording: Boolean(r.recording_url),
    category,
    categoryKey,
    secondaryCategories: r.secondary_categories || [],
    allCategories: [categoryKey],
    aiCategoryReasoning: null,
    iqsScore: iqsScore,
    gates: {
      status: (complianceTripwire ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL',
      reason: r.compliance_reason || undefined,
    },
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

  // Option A: If data is hidden for now, return clean empty state without touching database rows
  if (HIDE_DATA_FOR_NOW) {
    return NextResponse.json({
      success: true,
      total: 0,
      page: 1,
      limit,
      totalPages: 1,
      calls: [],
      rms: [],
      rmScorecards: [],
      teamLeads: [
        {
          tlName: 'Gokul',
          teamSize: TL_TEAMS.Gokul.length,
          totalCalls: 0,
          connectRate: 0,
          avgScore: 0,
          callsUnder85: 0,
          rms: TL_TEAMS.Gokul,
        },
        {
          tlName: 'Vaishnavi',
          teamSize: TL_TEAMS.Vaishnavi.length,
          totalCalls: 0,
          connectRate: 0,
          avgScore: 0,
          callsUnder85: 0,
          rms: TL_TEAMS.Vaishnavi,
        },
      ],
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

  // Dynamic conditions for query
  const whereClauses: string[] = ['r.start_time >= $1 AND r.start_time <= $2'];
  const queryParams: any[] = [startDateIso, endDateIso];

  if (rmFilter && rmFilter !== 'all') {
    queryParams.push(rmFilter);
    whereClauses.push(
      `LOWER(COALESCE(NULLIF(e.rm_name, 'Unknown'), NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = LOWER($${queryParams.length})`
    );
  }

  if (tlFilter && tlFilter !== 'all') {
    const cleanTl = tlFilter.replace(/^Team\s+/i, '');
    const teamMembers = TL_TEAMS[cleanTl] || [];
    if (teamMembers.length > 0) {
      queryParams.push(teamMembers.map(m => m.toLowerCase()));
      whereClauses.push(
        `(e.tl_name ILIKE '%${cleanTl}%' OR LOWER(COALESCE(NULLIF(e.rm_name, 'Unknown'), NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($${queryParams.length}))`
      );
    } else {
      queryParams.push(`%${cleanTl}%`);
      whereClauses.push(`e.tl_name ILIKE $${queryParams.length}`);
    }
  }

  if (categoryFilter && categoryFilter !== 'all') {
    if (categoryFilter === 'coaching_available') {
      whereClauses.push(`(e.ai_coaching_tip IS NOT NULL AND e.ai_coaching_tip != '')`);
    } else if (categoryFilter === '13_pitching') {
      whereClauses.push(`(e.call_category = '13_pitching' OR r.call_category ILIKE '%13%' OR r.call_category ILIKE '%pitch%')`);
    } else if (categoryFilter === 'upselling') {
      whereClauses.push(`(e.call_category = 'upselling' OR r.call_category ILIKE '%upsell%')`);
    } else if (categoryFilter === 'support') {
      whereClauses.push(`(e.call_category = 'support' OR r.call_category ILIKE '%support%' OR r.call_category ILIKE '%general%')`);
    }
  }

  if (searchFilter) {
    queryParams.push(`%${searchFilter}%`);
    const pIdx = queryParams.length;
    whereClauses.push(
      `(r.call_id ILIKE $${pIdx} OR r.phone_number ILIKE $${pIdx} OR r.called_by ILIKE $${pIdx} OR r.agent_name ILIKE $${pIdx} OR e.rm_name ILIKE $${pIdx})`
    );
  }

  // Min and Max IQS filters
  if (minIqsParam && minIqsParam !== 'all') {
    const minVal = parseFloat(minIqsParam);
    if (!isNaN(minVal)) {
      queryParams.push(minVal);
      whereClauses.push(`e.iqs_score >= $${queryParams.length}`);
    }
  }

  if (maxIqsParam && maxIqsParam !== 'all') {
    const maxVal = parseFloat(maxIqsParam);
    if (!isNaN(maxVal)) {
      queryParams.push(maxVal);
      whereClauses.push(`e.iqs_score <= $${queryParams.length}`);
    }
  }

  // Summary where clause (before table-specific answered / unanswered filter)
  const summaryWhereSql = whereClauses.join(' AND ');

  // Table status filter
  const tableWhereClauses = [...whereClauses];
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
    // 1. Fetch Summary statistics from real recordings + evaluations
    const summaryRows = await query(`
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
    `, queryParams);

    const sRow = summaryRows[0] || {};

    // 2. Total count for table
    const countRows = await query(`
      SELECT COUNT(*)::int AS total
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE ${tableWhereSql}
    `, queryParams);
    const total = countRows[0]?.total || 0;

    // 3. Paginated calls for table
    const paginatedParams = [...queryParams, limit, offset];
    const callsRows = await query(`
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
    `, paginatedParams);

    const calls = callsRows.map(mapRowToCall);

    // 4. Real RM counts from database
    const rmsRows = await query(`
      SELECT
        COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM') AS name,
        COUNT(*)::int AS count
      FROM pcg_call_recordings r
      WHERE r.start_time >= $1 AND r.start_time <= $2
      GROUP BY 1
      ORDER BY count DESC
    `, [startDateIso, endDateIso]);

    const rms = rmsRows.map(row => ({
      name: row.name,
      count: row.count,
    }));

    // 5. RM Scorecards calculated from real call records
    const rmStatsRows = await query(`
      SELECT
        COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM') AS rm_name,
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))::int AS answered_calls,
        ROUND(AVG(e.iqs_score), 1)::float AS avg_iqs,
        ROUND(AVG(CASE WHEN r.start_time >= (NOW() - INTERVAL '7 days') THEN e.iqs_score END), 1)::float AS recent_iqs,
        ROUND(AVG(CASE WHEN r.start_time < (NOW() - INTERVAL '7 days') THEN e.iqs_score END), 1)::float AS prev_iqs,
        ROUND(AVG(CASE WHEN e.call_category = '13_pitching' OR r.call_category ILIKE '%13%' OR r.call_category ILIKE '%pitch%' THEN e.iqs_score END), 1)::float AS pitch_score,
        ROUND(AVG(CASE WHEN e.call_category = 'upselling' OR r.call_category ILIKE '%upsell%' THEN e.iqs_score END), 1)::float AS upsell_score,
        ROUND(AVG(CASE WHEN e.call_category = 'support' OR r.call_category ILIKE '%support%' OR r.call_category ILIKE '%general%' THEN e.iqs_score END), 1)::float AS support_score,
        COUNT(*) FILTER (WHERE e.compliance_tripwire = true)::int AS compliance_flags
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE r.start_time >= $1 AND r.start_time <= $2
      GROUP BY 1
      ORDER BY total_calls DESC
    `, [startDateIso, endDateIso]);

    const rmScorecards = rmStatsRows.map(r => {
      const totalCalls = r.total_calls || 0;
      const answeredCalls = r.answered_calls || 0;
      const connectRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
      const overallScore = r.avg_iqs != null ? Math.round(r.avg_iqs) : 0;
      const recentIqs = r.recent_iqs != null ? Number(r.recent_iqs) : overallScore;
      const prevIqs = r.prev_iqs != null ? Number(r.prev_iqs) : overallScore;
      const delta2Wk = r.recent_iqs != null && r.prev_iqs != null
        ? Math.round((recentIqs - prevIqs) * 10) / 10
        : 0;
      const trend: 'improving' | 'declining' | 'stable' =
        delta2Wk > 0 ? 'improving' : (delta2Wk < 0 ? 'declining' : 'stable');

      return {
        rmName: r.rm_name,
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
        topWeakness: overallScore > 0 && overallScore < 85 ? 'Technical / Legal disclosures' : '—',
      };
    });

    // 6. Team Leads Summaries calculated from real team mappings
    const gokulMembers = TL_TEAMS.Gokul.map(m => m.toLowerCase());
    const vaishnaviMembers = TL_TEAMS.Vaishnavi.map(m => m.toLowerCase());

    const tlStatsRows = await query(`
      SELECT
        CASE
          WHEN LOWER(COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($3) THEN 'Gokul'
          WHEN LOWER(COALESCE(NULLIF(r.called_by, ''), NULLIF(r.agent_name, 'Unknown'), 'Unknown RM')) = ANY($4) THEN 'Vaishnavi'
          ELSE 'Other'
        END AS tl_group,
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))::int AS answered_calls,
        ROUND(AVG(e.iqs_score), 1)::float AS avg_iqs,
        COUNT(*) FILTER (WHERE e.compliance_tripwire = true OR (e.iqs_score IS NOT NULL AND e.iqs_score < 85))::int AS calls_under_85
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE r.start_time >= $1 AND r.start_time <= $2
      GROUP BY 1
    `, [startDateIso, endDateIso, gokulMembers, vaishnaviMembers]);

    const gokulStats = tlStatsRows.find(t => t.tl_group === 'Gokul');
    const vaishnaviStats = tlStatsRows.find(t => t.tl_group === 'Vaishnavi');

    const teamLeads = [
      {
        tlName: 'Gokul',
        teamSize: TL_TEAMS.Gokul.length,
        totalCalls: gokulStats?.total_calls || 0,
        connectRate: gokulStats && gokulStats.total_calls > 0
          ? Math.round((gokulStats.answered_calls / gokulStats.total_calls) * 100)
          : 0,
        avgScore: gokulStats?.avg_iqs != null ? gokulStats.avg_iqs : 0,
        callsUnder85: gokulStats?.calls_under_85 || 0,
        rms: TL_TEAMS.Gokul,
      },
      {
        tlName: 'Vaishnavi',
        teamSize: TL_TEAMS.Vaishnavi.length,
        totalCalls: vaishnaviStats?.total_calls || 0,
        connectRate: vaishnaviStats && vaishnaviStats.total_calls > 0
          ? Math.round((vaishnaviStats.answered_calls / vaishnaviStats.total_calls) * 100)
          : 0,
        avgScore: vaishnaviStats?.avg_iqs != null ? vaishnaviStats.avg_iqs : 0,
        callsUnder85: vaishnaviStats?.calls_under_85 || 0,
        rms: TL_TEAMS.Vaishnavi,
      },
    ];

    // 7. Department overall metrics (across all PCG calls in this time window)
    const deptSummaryRows = await query(`
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE r.duration_seconds > 0 AND (r.tag IS NULL OR r.tag != 'unanswered') AND (r.call_type IS NULL OR r.call_type != 'missed'))::int AS answered_calls,
        ROUND(AVG(e.iqs_score), 1)::float AS avg_iqs
      FROM pcg_call_recordings r
      LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
      WHERE r.start_time >= $1 AND r.start_time <= $2
    `, [startDateIso, endDateIso]);

    const dRow = deptSummaryRows[0] || {};
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

    try {
      const paramStatsRows = await query(`
        SELECT
          p->>'id' AS param_id,
          ROUND(
            SUM(CASE WHEN p->>'status' != 'NA' THEN (p->>'earnedScore')::numeric ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN p->>'status' != 'NA' THEN (p->>'maxScore')::numeric ELSE 0 END), 0)
          )::int AS avg_score
        FROM pcg_call_evaluations e
        JOIN pcg_call_recordings r ON r.call_id = e.call_id
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(e.parameters::jsonb) = 'array' THEN e.parameters::jsonb
            ELSE '[]'::jsonb
          END
        ) AS p
        WHERE r.start_time >= $1 AND r.start_time <= $2
        GROUP BY p->>'id'
      `, [startDateIso, endDateIso]);

      for (const row of paramStatsRows) {
        if (row.param_id && row.avg_score != null) {
          departmentStats.parameterScores[row.param_id] = row.avg_score;
        }
      }
    } catch (paramErr: any) {
      console.warn('[pcg-calls API] paramStats error:', paramErr?.message);
    }

    return NextResponse.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      rms,
      rmScorecards,
      teamLeads,
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
      },
      { status: 500 }
    );
  }
});
