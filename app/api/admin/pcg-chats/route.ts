import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireRole } from '@/lib/api-guard';
import { withLogging } from '@/lib/log';
import { query } from '@/lib/cx/db';
import { canonicalizePcgRmName, isSamePcgAgent, PCG_AM_NAMES, isPcgAm } from '@/lib/pcg/canonical-names';
import { getPcgRmsForTl } from '@/lib/pcg/rm-directory';
import { detectPcgChatCategories } from '@/lib/pcg/chat-category';

const ROUTE = 'admin/pcg-chats';

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  let sessionUser: any = null;
  try {
    const { response, session } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;
    sessionUser = session?.user;
  } catch {
    // Permitted in local development
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
  const offset = (page - 1) * limit;

  // Single chat lookup by ID
  const singleId = searchParams.get('id')?.trim();
  if (singleId) {
    const rows = await query<any>(`
      SELECT *
      FROM pcg_chat_evaluations
      WHERE id = $1
    `, [singleId]);

    if (!rows.length) {
      return NextResponse.json({ error: 'Chat evaluation not found' }, { status: 404 });
    }

    const r = rows[0];

    // Fetch all linked sessions for this customer
    const linkedRows = await query<any>(`
      SELECT id, conversation_id, chat_closed_at, total_messages, iqs_score, summary, verdict
      FROM pcg_chat_evaluations
      WHERE customer_phone = $1
      ORDER BY chat_closed_at ASC, id ASC
    `, [r.customer_phone]);

    const linkedSessions = linkedRows.map((s, idx) => ({
      id: String(s.id),
      conversationId: s.conversation_id ? String(s.conversation_id) : null,
      sessionNumber: idx + 1,
      chatClosedAt: s.chat_closed_at,
      totalMessages: s.total_messages || 0,
      iqsScore: s.iqs_score != null ? Number(s.iqs_score) : null,
      summary: s.summary || null,
      verdict: s.verdict,
    }));

    const singleChat = {
      id: String(r.id),
      customerPhone: r.customer_phone,
      wabaNumber: r.waba_number,
      customerName: r.customer_name || 'Client',
      rmName: r.rm_name,
      tlName: r.tl_name,
      iqsScore: r.iqs_score != null ? Number(r.iqs_score) : null,
      processScore: r.process_score != null ? Number(r.process_score) : null,
      communicationScore: r.communication_score != null ? Number(r.communication_score) : null,
      customerServiceScore: r.customer_service_score != null ? Number(r.customer_service_score) : null,
      applicableWeight: r.applicable_weight != null ? Number(r.applicable_weight) : 0,
      verdict: r.verdict,
      isEvaluable: r.is_evaluable,
      exclusionReason: r.exclusion_reason,
      summary: r.summary || null,
      linkedSessions,
      parameters: typeof r.parameters === 'string' ? JSON.parse(r.parameters) : r.parameters,
      complianceFlags: typeof r.compliance_flags === 'string' ? JSON.parse(r.compliance_flags) : (r.compliance_flags || []),
      complianceTripwire: Boolean(r.compliance_tripwire),
      complianceReason: r.compliance_reason,
      aiCoachingTip: r.ai_coaching_tip,
      totalMessages: r.total_messages || 0,
      firstResponseTimeSeconds: r.first_response_time_seconds,
      transcriptTurns: typeof r.transcript_turns === 'string' ? JSON.parse(r.transcript_turns) : (r.transcript_turns || []),
      chatClosedAt: r.chat_closed_at,
      scoredAt: r.scored_at,
      disputeStatus: r.dispute_status || 'none',
      disputeReason: r.dispute_reason,
      disputeComments: typeof r.dispute_comments === 'string' ? JSON.parse(r.dispute_comments) : (Array.isArray(r.dispute_comments) ? r.dispute_comments : []),
      tlOverrideNote: r.tl_override_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      isAm: Boolean(r.is_am),
      precedingRmName: r.preceding_rm_name || null,
    };
    return NextResponse.json({
      chat: {
        ...singleChat,
        categories: detectPcgChatCategories(singleChat),
      }
    });
  }

  // Filters
  const callerRole = searchParams.get('caller_role')?.trim()?.toLowerCase(); // 'tl' | 'rm' | 'am' | 'team'
  const rmFilter = searchParams.get('rm')?.trim();
  const amFilter = searchParams.get('am')?.trim();
  const dualFilter = searchParams.get('dual')?.trim();
  const roleFilter = searchParams.get('role')?.trim()?.toLowerCase(); // 'rm' | 'am' | 'dual' | 'tl' | 'team' | 'all'
  const tlFilter = searchParams.get('tl')?.trim();
  const verdictFilter = searchParams.get('verdict')?.trim();
  const disputeFilter = searchParams.get('disputeStatus')?.trim();
  const sectionFilter = searchParams.get('section')?.trim();
  const personaParam = searchParams.get('persona')?.trim();
  const searchQuery = searchParams.get('search')?.trim();
  const categoryFilter = searchParams.get('category')?.trim();
  const minIqsParam = searchParams.get('min_iqs')?.trim();
  const maxIqsParam = searchParams.get('max_iqs')?.trim();
  const startDate = searchParams.get('startDate')?.trim() || searchParams.get('date_from')?.trim();
  const endDate = searchParams.get('endDate')?.trim() || searchParams.get('date_to')?.trim();
  const handlingType = searchParams.get('handling_type')?.trim()?.toLowerCase() || searchParams.get('chat_mode')?.trim()?.toLowerCase() || 'all';

  const conditions: string[] = ['1=1'];
  const params: any[] = [];
  let paramIdx = 1;

  const ALL_TL_NAMES = [
    'Swetha',
    'Swetha Jayakumar',
    'Saiyam Rastogi',
    'Tanisha Mittal',
    'Dheeraj Bhojwani',
    'Sravanthi',
  ];

  // Resolve effective TL for scoping:
  const userRole = sessionUser?.role;
  const isAgentPersona = personaParam === 'agent' || userRole === 'agent';
  const isTlPersona = personaParam === 'tl' || userRole === 'tl';
  const effectiveTl = isTlPersona
    ? (tlFilter && tlFilter !== 'all' ? tlFilter : sessionUser?.name || sessionUser?.email || 'Swetha')
    : (tlFilter && tlFilter !== 'all' ? tlFilter : null);

  let mappedMembers: string[] = [];
  if (effectiveTl && effectiveTl !== 'all') {
    mappedMembers = await getPcgRmsForTl(effectiveTl);
  }

  // TL chats are strictly visible to Admin only.
  // In Team Lead view (or non-admin personas), all TL-handled chats must be excluded.
  if (personaParam !== 'admin') {
    conditions.push(`(is_tl = false OR is_tl IS NULL)`);
    conditions.push(`NOT (LOWER(TRIM(rm_name)) = ANY($${paramIdx}::text[]))`);
    conditions.push(`(preceding_rm_name IS NULL OR NOT (LOWER(TRIM(preceding_rm_name)) = ANY($${paramIdx}::text[])))`);
    params.push(ALL_TL_NAMES.map(n => n.toLowerCase()));
    paramIdx++;
  }

  // Target cohort resolution:
  const effectiveCohort = isAgentPersona
    ? null
    : (callerRole === 'tl' || roleFilter === 'tl')
    ? 'tl'
    : (callerRole === 'dual' || roleFilter === 'dual' || dualFilter === 'true' || dualFilter === 'dual')
    ? 'dual'
    : (callerRole === 'am' || roleFilter === 'am' || (amFilter && amFilter !== 'all'))
    ? 'am'
    : (callerRole === 'rm' || roleFilter === 'rm' || (rmFilter && rmFilter !== 'all'))
    ? 'rm'
    : (callerRole === 'team')
    ? 'team'
    : null;

  if (isAgentPersona) {
    // When an agent views their own chat quality, show all chats they handled or co-handled
    const effectiveAgentName = (rmFilter && rmFilter !== 'all') ? rmFilter : sessionUser?.name;
    if (effectiveAgentName) {
      const canonicalReq = canonicalizePcgRmName(effectiveAgentName);
      conditions.push(`(
        LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx}))
        OR LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx + 1}))
        OR LOWER(TRIM(preceding_rm_name)) = LOWER(TRIM($${paramIdx}))
        OR LOWER(TRIM(preceding_rm_name)) = LOWER(TRIM($${paramIdx + 1}))
      )`);
      params.push(effectiveAgentName, canonicalReq);
      paramIdx += 2;
    }
  } else if (effectiveCohort === 'tl') {
    // When querying for TL Chat Quality: filter for chats handled by TLs
    conditions.push(`(is_tl = true OR LOWER(TRIM(rm_name)) = ANY($${paramIdx}::text[]))`);
    params.push(ALL_TL_NAMES.map(n => n.toLowerCase()));
    paramIdx++;

    const effectiveHandler = (tlFilter && tlFilter !== 'all') ? tlFilter : (rmFilter && rmFilter !== 'all') ? rmFilter : null;
    if (effectiveHandler) {
      const cleanTl = effectiveHandler.replace(/^Team\s+/i, '').trim().toLowerCase();
      const canonicalTl = canonicalizePcgRmName(cleanTl).toLowerCase();
      conditions.push(`(
        LOWER(TRIM(rm_name)) = LOWER($${paramIdx})
        OR LOWER(TRIM(rm_name)) = LOWER($${paramIdx + 1})
        OR LOWER(TRIM(rm_name)) LIKE LOWER($${paramIdx + 2})
      )`);
      params.push(cleanTl, canonicalTl, `%${cleanTl}%`);
      paramIdx += 3;
    }
  } else if (effectiveCohort === 'dual') {
    // Co-handled dual chats only (has mid-thread handoff)
    conditions.push(`(preceding_rm_name IS NOT NULL AND TRIM(preceding_rm_name) != '')`);

    if (mappedMembers.length > 0 && personaParam !== 'admin') {
      const cleanTl = effectiveTl?.replace(/^Team\s+/i, '').trim() || '';
      conditions.push(`(
        rm_name = ANY($${paramIdx}::text[])
        OR preceding_rm_name = ANY($${paramIdx}::text[])
        OR LOWER(tl_name) = LOWER($${paramIdx + 1})
        OR LOWER(tl_name) = LOWER($${paramIdx + 2})
        OR LOWER(REPLACE(tl_name, 'Team ', '')) = LOWER($${paramIdx + 1})
      )`);
      params.push(mappedMembers, cleanTl, `Team ${cleanTl}`);
      paramIdx += 3;
    } else if (effectiveTl && effectiveTl !== 'all') {
      const cleanTl = effectiveTl.replace(/^Team\s+/i, '').trim();
      conditions.push(`(
        LOWER(tl_name) = LOWER($${paramIdx})
        OR LOWER(tl_name) = LOWER($${paramIdx + 1})
        OR LOWER(REPLACE(tl_name, 'Team ', '')) = LOWER($${paramIdx})
      )`);
      params.push(cleanTl, `Team ${cleanTl}`);
      paramIdx += 2;
    }

    if (dualFilter && dualFilter !== 'all' && dualFilter !== 'all_dual' && dualFilter !== 'true') {
      conditions.push(`(
        LOWER(TRIM(rm_name)) LIKE LOWER($${paramIdx})
        OR LOWER(TRIM(preceding_rm_name)) LIKE LOWER($${paramIdx})
      )`);
      params.push(`%${dualFilter}%`);
      paramIdx++;
    }
  } else if (effectiveCohort === 'rm') {
    // RM handled conversations: handled END-TO-END by an RM with NO handoffs
    conditions.push(`(
      (preceding_rm_name IS NULL OR TRIM(preceding_rm_name) = '')
      AND (is_am IS NOT TRUE)
      AND (is_tl IS NOT TRUE)
      AND NOT (LOWER(TRIM(rm_name)) = ANY($${paramIdx}::text[]))
      AND NOT (LOWER(TRIM(rm_name)) = ANY($${paramIdx + 1}::text[]))
    )`);
    params.push(Array.from(PCG_AM_NAMES).map((n: string) => n.toLowerCase()), ALL_TL_NAMES.map(n => n.toLowerCase()));
    paramIdx += 2;

    if (mappedMembers.length > 0 && personaParam !== 'admin') {
      if (rmFilter && rmFilter !== 'all' && rmFilter !== 'all_rms') {
        const canonicalReq = canonicalizePcgRmName(rmFilter);
        const isMapped = mappedMembers.some(m => isSamePcgAgent(m, canonicalReq));
        if (isMapped) {
          conditions.push(`(
            LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx}))
            OR LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx + 1}))
          )`);
          params.push(rmFilter, canonicalReq);
          paramIdx += 2;
        } else {
          conditions.push(`1 = 0`);
        }
      } else {
        const rmOnly = mappedMembers.filter(m => !isPcgAm(m));
        conditions.push(`(rm_name = ANY($${paramIdx}::text[]) OR LOWER(TRIM(rm_name)) = ANY($${paramIdx + 1}::text[]))`);
        params.push(rmOnly, rmOnly.map(m => m.toLowerCase()));
        paramIdx += 2;
      }
    } else if (rmFilter && rmFilter !== 'all' && rmFilter !== 'all_rms') {
      const canonicalReq = canonicalizePcgRmName(rmFilter);
      conditions.push(`(
        LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx}))
        OR LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx + 1}))
      )`);
      params.push(rmFilter, canonicalReq);
      paramIdx += 2;
    } else if (effectiveTl && effectiveTl !== 'all') {
      const cleanTl = effectiveTl.replace(/^Team\s+/i, '').trim();
      conditions.push(`(
        LOWER(tl_name) = LOWER($${paramIdx})
        OR LOWER(tl_name) = LOWER($${paramIdx + 1})
        OR LOWER(REPLACE(tl_name, 'Team ', '')) = LOWER($${paramIdx})
      )`);
      params.push(cleanTl, `Team ${cleanTl}`);
      paramIdx += 2;
    }
  } else if (effectiveCohort === 'am') {
    // AM handled conversations: handled END-TO-END by an AM with NO handoffs
    conditions.push(`(
      (preceding_rm_name IS NULL OR TRIM(preceding_rm_name) = '')
      AND (is_am IS TRUE OR LOWER(TRIM(rm_name)) = ANY($${paramIdx}::text[]))
      AND (is_tl IS NOT TRUE)
      AND NOT (LOWER(TRIM(rm_name)) = ANY($${paramIdx + 1}::text[]))
    )`);
    params.push(Array.from(PCG_AM_NAMES).map((n: string) => n.toLowerCase()), ALL_TL_NAMES.map(n => n.toLowerCase()));
    paramIdx += 2;

    if (mappedMembers.length > 0 && personaParam !== 'admin') {
      if (amFilter && amFilter !== 'all' && amFilter !== 'all_ams') {
        const canonicalReq = canonicalizePcgRmName(amFilter);
        const isMapped = mappedMembers.some(m => isSamePcgAgent(m, canonicalReq));
        if (isMapped) {
          conditions.push(`(
            LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx}))
            OR LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx + 1}))
          )`);
          params.push(amFilter, canonicalReq);
          paramIdx += 2;
        } else {
          conditions.push(`1 = 0`);
        }
      } else {
        const amOnly = mappedMembers.filter(m => isPcgAm(m));
        conditions.push(`(rm_name = ANY($${paramIdx}::text[]) OR LOWER(TRIM(rm_name)) = ANY($${paramIdx + 1}::text[]))`);
        params.push(amOnly, amOnly.map(m => m.toLowerCase()));
        paramIdx += 2;
      }
    } else if (amFilter && amFilter !== 'all' && amFilter !== 'all_ams') {
      const canonicalReq = canonicalizePcgRmName(amFilter);
      conditions.push(`(
        LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx}))
        OR LOWER(TRIM(rm_name)) = LOWER(TRIM($${paramIdx + 1}))
      )`);
      params.push(amFilter, canonicalReq);
      paramIdx += 2;
    } else if (effectiveTl && effectiveTl !== 'all') {
      const cleanTl = effectiveTl.replace(/^Team\s+/i, '').trim();
      conditions.push(`(
        LOWER(tl_name) = LOWER($${paramIdx})
        OR LOWER(tl_name) = LOWER($${paramIdx + 1})
        OR LOWER(REPLACE(tl_name, 'Team ', '')) = LOWER($${paramIdx})
      )`);
      params.push(cleanTl, `Team ${cleanTl}`);
      paramIdx += 2;
    }
  } else if (effectiveCohort === 'team' || (tlFilter && tlFilter !== 'all')) {
    // Specific Team scope
    const cleanTl = (tlFilter || '').replace(/^Team\s+/i, '').trim();
    if (cleanTl && cleanTl !== 'all') {
      conditions.push(`(
        LOWER(tl_name) = LOWER($${paramIdx})
        OR LOWER(tl_name) = LOWER($${paramIdx + 1})
        OR LOWER(REPLACE(tl_name, 'Team ', '')) = LOWER($${paramIdx})
        ${mappedMembers.length > 0 ? `OR rm_name = ANY($${paramIdx + 2}::text[])` : ''}
      )`);
      params.push(cleanTl, `Team ${cleanTl}`);
      if (mappedMembers.length > 0) params.push(mappedMembers);
      paramIdx += mappedMembers.length > 0 ? 3 : 2;
    }
  } else {
    // Default state: ALL chats across the entire organization (RMs, AMs, TLs, Dual) are shown
    if (mappedMembers.length > 0 && personaParam !== 'admin') {
      const cleanTl = effectiveTl?.replace(/^Team\s+/i, '').trim() || '';
      conditions.push(`(
        rm_name = ANY($${paramIdx}::text[])
        OR preceding_rm_name = ANY($${paramIdx}::text[])
        OR LOWER(tl_name) = LOWER($${paramIdx + 1})
        OR LOWER(tl_name) = LOWER($${paramIdx + 2})
        OR LOWER(REPLACE(tl_name, 'Team ', '')) = LOWER($${paramIdx + 1})
      )`);
      params.push(mappedMembers, cleanTl, `Team ${cleanTl}`);
      paramIdx += 3;
    }
  }

  // Add date range filter to scope (used for overall summary KPIs)
  if (startDate) {
    conditions.push(`chat_closed_at >= $${paramIdx}`);
    params.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    const formattedEnd = endDate.includes('T') || endDate.includes(' ') ? endDate : `${endDate} 23:59:59`;
    conditions.push(`chat_closed_at <= $${paramIdx}`);
    params.push(formattedEnd);
    paramIdx++;
  }

  // Exclude NA (unscoreable / unvoiced) and non-client excluded chats (e.g. hiring, candidate applications) by default
  const isNaFilter = categoryFilter === 'not_scoreable' || verdictFilter === 'NOT_SCOREABLE' || verdictFilter === 'not_scoreable' || verdictFilter === 'na' || categoryFilter === 'excluded';

  if (isNaFilter) {
    conditions.push(`(verdict IN ('NOT_SCOREABLE', 'EXCLUDED_NON_CLIENT') OR is_evaluable = false OR iqs_score IS NULL)`);
  } else {
    conditions.push(`(verdict NOT IN ('NOT_SCOREABLE', 'EXCLUDED_NON_CLIENT') AND is_evaluable IS NOT FALSE AND iqs_score IS NOT NULL)`);
  }

  // 1. Scope / Date Range conditions for overall summary & top banner KPI cards (independent of table pagination & table-only filters)
  const scopeConditions = [...conditions];
  const scopeParams = [...params];

  // 2. Table-specific filters (search, verdict, min/max IQS)
  if (verdictFilter && verdictFilter !== 'all' && verdictFilter !== 'not_scoreable' && verdictFilter !== 'NOT_SCOREABLE' && verdictFilter !== 'na') {
    if (verdictFilter === 'tripwire') {
      conditions.push(`compliance_tripwire = true`);
    } else if (verdictFilter === 'clean') {
      conditions.push(`(compliance_tripwire = false OR compliance_tripwire IS NULL)`);
    } else {
      conditions.push(`verdict = $${paramIdx}`);
      params.push(verdictFilter);
      paramIdx++;
    }
  }

  if (searchQuery) {
    conditions.push(`(customer_phone ILIKE $${paramIdx} OR customer_name ILIKE $${paramIdx} OR rm_name ILIKE $${paramIdx} OR preceding_rm_name ILIKE $${paramIdx})`);
    params.push(`%${searchQuery}%`);
    paramIdx++;
  }

  if (minIqsParam && !isNaN(parseFloat(minIqsParam))) {
    conditions.push(`iqs_score >= $${paramIdx}`);
    params.push(parseFloat(minIqsParam));
    paramIdx++;
  }

  if (maxIqsParam && !isNaN(parseFloat(maxIqsParam))) {
    conditions.push(`iqs_score <= $${paramIdx}`);
    params.push(parseFloat(maxIqsParam));
    paramIdx++;
  }

  // Preserve base conditions before section/dispute-specific filter to calculate live tab badge counts
  const baseConditions = [...conditions];
  const baseParams = [...params];

  // Section Filtering for TL / Admin / Agent:
  if (sectionFilter && sectionFilter !== 'all') {
    if (sectionFilter === 'pending_evaluation') {
      conditions.push(`(status != 'reviewed' OR status IS NULL) AND reviewed_by IS NULL AND (dispute_status != 'pending' OR dispute_status IS NULL)`);
    } else if (sectionFilter === 'evaluated') {
      if (isAgentPersona) {
        conditions.push(`(dispute_status != 'pending' OR dispute_status IS NULL) AND (dispute_reason IS NULL OR dispute_reason = '' OR dispute_status = 'none')`);
      } else {
        conditions.push(`(status = 'reviewed' OR reviewed_by IS NOT NULL) AND (dispute_status != 'pending' OR dispute_status IS NULL) AND (dispute_reason IS NULL OR dispute_reason = '' OR dispute_status = 'none')`);
      }
    } else if (sectionFilter === 'disputes_pending' || sectionFilter === 'disputes_raised') {
      conditions.push(`dispute_status = 'pending'`);
    } else if (sectionFilter === 'disputes_reviewed') {
      conditions.push(`(dispute_status IN ('resolved', 'overridden') OR (status = 'reviewed' AND reviewed_by IS NOT NULL)) AND (dispute_reason IS NOT NULL AND dispute_reason != '') AND dispute_status != 'pending'`);
    } else if (disputeFilter && disputeFilter !== 'all') {
      conditions.push(`dispute_status = $${paramIdx}`);
      params.push(disputeFilter);
      paramIdx++;
    }
  }

  const tableWhereClause = conditions.join(' AND ');
  const baseWhereClause = baseConditions.join(' AND ');
  const scopeWhereClause = scopeConditions.join(' AND ');

  // Fetch summary (overall analytics for selected agent/rm/tl & date range), section counts & table total count concurrently
  const [summaryRows, sectionCountsRows, countRows] = await Promise.all([
    query<any>(`
      SELECT
        COUNT(*) AS total_count,
        ROUND(AVG(iqs_score)::numeric, 1) AS avg_iqs,
        COUNT(CASE WHEN compliance_tripwire = true THEN 1 END) AS tripwire_count,
        ROUND(AVG(first_response_time_seconds)::numeric, 0) AS avg_frt,
        COUNT(CASE WHEN verdict = 'excellent' THEN 1 END) AS excellent_count,
        COUNT(CASE WHEN verdict = 'meets_expectations' THEN 1 END) AS meets_count,
        COUNT(CASE WHEN verdict = 'coaching' THEN 1 END) AS coaching_count,
        COUNT(CASE WHEN verdict = 'remediation' THEN 1 END) AS remediation_count,
        COUNT(CASE WHEN verdict = 'NOT_SCOREABLE' THEN 1 END) AS not_scoreable_count
      FROM pcg_chat_evaluations
      WHERE ${scopeWhereClause}
    `, scopeParams),
    query<any>(`
      SELECT
        COUNT(CASE WHEN (status != 'reviewed' OR status IS NULL) AND reviewed_by IS NULL AND (dispute_status != 'pending' OR dispute_status IS NULL) THEN 1 END) AS pending_evaluation_count,
        COUNT(CASE WHEN ${isAgentPersona ? "(dispute_status != 'pending' OR dispute_status IS NULL) AND (dispute_reason IS NULL OR dispute_reason = '' OR dispute_status = 'none')" : "(status = 'reviewed' OR reviewed_by IS NOT NULL) AND (dispute_status != 'pending' OR dispute_status IS NULL) AND (dispute_reason IS NULL OR dispute_reason = '' OR dispute_status = 'none')"} THEN 1 END) AS evaluated_count,
        COUNT(CASE WHEN dispute_status = 'pending' THEN 1 END) AS disputes_pending_count,
        COUNT(CASE WHEN (dispute_status IN ('resolved', 'overridden') OR (status = 'reviewed' AND reviewed_by IS NOT NULL)) AND (dispute_reason IS NOT NULL AND dispute_reason != '') AND dispute_status != 'pending' THEN 1 END) AS disputes_reviewed_count
      FROM pcg_chat_evaluations
      WHERE ${baseWhereClause}
    `, baseParams),
    query<any>(`
      SELECT COUNT(*) AS total
      FROM pcg_chat_evaluations
      WHERE ${tableWhereClause}
    `, params),
  ]);

  const summary = summaryRows[0] || {};
  const sectionCounts = {
    pendingEvaluation: Number(sectionCountsRows[0]?.pending_evaluation_count || 0),
    evaluated: Number(sectionCountsRows[0]?.evaluated_count || 0),
    disputesPending: Number(sectionCountsRows[0]?.disputes_pending_count || 0),
    disputesReviewed: Number(sectionCountsRows[0]?.disputes_reviewed_count || 0),
  };
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Fetch paginated chats
  const chatRows = await query<any>(`
    SELECT
      id, conversation_id, customer_phone, waba_number, customer_name, rm_name, tl_name,
      iqs_score, process_score, communication_score, customer_service_score,
      applicable_weight, verdict, is_evaluable, exclusion_reason, summary,
      parameters, compliance_flags, compliance_tripwire, compliance_reason,
      ai_coaching_tip, total_messages, first_response_time_seconds,
      transcript_turns, chat_closed_at, scored_at,
      dispute_status, dispute_reason, dispute_comments, tl_override_note, reviewed_by, reviewed_at,
      is_am, preceding_rm_name
    FROM pcg_chat_evaluations
    WHERE ${tableWhereClause}
    ORDER BY chat_closed_at DESC, id DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `, [...params, limit, offset]);

  // Fetch available RMs and TLs for filter options
  let availableRms: Array<{ name: string; count: number }> = [];
  let availableTls: Array<{ name: string; count: number }> = [];

  // Canonical Team Leads across PCG
  const CANONICAL_TLS = [
    'Dheeraj Bhojwani',
    'Saiyam Rastogi',
    'Sravanthi',
    'Swetha',
    'Tanisha Mittal',
  ];

  if (mappedMembers.length > 0 && personaParam !== 'admin') {
    // Strictly return only this TL's mapped members!
    try {
      const rmCounts = await query<any>(`
        SELECT rm, COUNT(*) as count FROM (
          SELECT rm_name as rm FROM pcg_chat_evaluations WHERE rm_name = ANY($1::text[])
          UNION ALL
          SELECT preceding_rm_name as rm FROM pcg_chat_evaluations WHERE preceding_rm_name = ANY($1::text[])
        ) t
        GROUP BY rm
      `, [mappedMembers]);

      const countMap = new Map<string, number>();
      for (const r of rmCounts) {
        countMap.set(canonicalizePcgRmName(r.rm), Number(r.count));
      }

      availableRms = mappedMembers.map(name => ({
        name,
        count: countMap.get(name) || 0,
      }));
    } catch {
      availableRms = mappedMembers.map(name => ({ name, count: 0 }));
    }
  } else {
    // Admin cross-team view: include all master directory RMs merged with chat evaluation counts
    try {
      const [dirRmRows, evalRmRows] = await Promise.all([
        query<any>(`
          SELECT DISTINCT rm_name
          FROM pcg_rm_directory
          WHERE role != 'tl' AND status = 'active'
        `).catch(() => []),
        query<any>(`
          SELECT rm, COUNT(*) as count FROM (
            SELECT rm_name as rm FROM pcg_chat_evaluations WHERE rm_name IS NOT NULL
            UNION ALL
            SELECT preceding_rm_name as rm FROM pcg_chat_evaluations WHERE preceding_rm_name IS NOT NULL AND TRIM(preceding_rm_name) != ''
          ) t
          GROUP BY rm
        `).catch(() => []),
      ]);

      const countMap = new Map<string, number>();
      evalRmRows.forEach((r: any) => countMap.set(canonicalizePcgRmName(r.rm).toLowerCase(), Number(r.count)));

      const allRmNames = new Set<string>();
      dirRmRows.forEach((r: any) => allRmNames.add(canonicalizePcgRmName(r.rm_name)));
      evalRmRows.forEach((r: any) => allRmNames.add(canonicalizePcgRmName(r.rm_name)));

      availableRms = Array.from(allRmNames)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          count: countMap.get(name.toLowerCase()) || 0,
        }));
    } catch {
      availableRms = [];
    }

    // TL options for Admin: include all canonical & directory TL teams
    try {
      const [dirTlRows, evalTlRows] = await Promise.all([
        query<any>(`
          SELECT DISTINCT tl_name
          FROM pcg_rm_directory
          WHERE tl_name IS NOT NULL AND status = 'active' AND tl_name != 'Team Admin'
        `).catch(() => []),
        query<any>(`
          SELECT tl_name, COUNT(*) as count
          FROM pcg_chat_evaluations
          GROUP BY tl_name
        `).catch(() => []),
      ]);

      const tlCountMap = new Map<string, number>();
      evalTlRows.forEach((r: any) => tlCountMap.set((r.tl_name || '').toLowerCase(), Number(r.count)));

      const allTlNames = new Set<string>(CANONICAL_TLS);
      dirTlRows.forEach((r: any) => {
        if (r.tl_name) allTlNames.add(r.tl_name.replace(/^Team\s+/i, ''));
      });
      evalTlRows.forEach((r: any) => {
        if (r.tl_name) allTlNames.add(r.tl_name.replace(/^Team\s+/i, ''));
      });

      availableTls = Array.from(allTlNames)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          count: tlCountMap.get(name.toLowerCase()) || tlCountMap.get(`team ${name}`.toLowerCase()) || 0,
        }));
    } catch {
      availableTls = CANONICAL_TLS.map((name) => ({ name, count: 0 }));
    }
  }

  // Group all linked sessions for customers on this page
  const customerPhones = Array.from(new Set(chatRows.map(r => r.customer_phone).filter(Boolean)));
  const sessionsByPhone = new Map<string, any[]>();
  if (customerPhones.length > 0) {
    const allCustomerSessions = await query<any>(`
      SELECT id, conversation_id, customer_phone, chat_closed_at, total_messages, iqs_score, summary, verdict
      FROM pcg_chat_evaluations
      WHERE customer_phone = ANY($1::varchar[])
      ORDER BY chat_closed_at ASC, id ASC
    `, [customerPhones]);

    for (const s of allCustomerSessions) {
      const list = sessionsByPhone.get(s.customer_phone) || [];
      list.push({
        id: String(s.id),
        conversationId: s.conversation_id ? String(s.conversation_id) : null,
        sessionNumber: list.length + 1,
        chatClosedAt: s.chat_closed_at,
        totalMessages: s.total_messages || 0,
        iqsScore: s.iqs_score != null ? Number(s.iqs_score) : null,
        summary: s.summary || null,
        verdict: s.verdict,
      });
      sessionsByPhone.set(s.customer_phone, list);
    }
  }

  let chats = chatRows.map(r => {
    const chatObj = {
      id: String(r.id),
      conversationId: r.conversation_id ? String(r.conversation_id) : null,
      customerPhone: r.customer_phone,
      wabaNumber: r.waba_number,
      customerName: r.customer_name || 'Client',
      rmName: r.rm_name,
      tlName: r.tl_name,
      iqsScore: r.iqs_score != null ? Number(r.iqs_score) : null,
      processScore: r.process_score != null ? Number(r.process_score) : null,
      communicationScore: r.communication_score != null ? Number(r.communication_score) : null,
      customerServiceScore: r.customer_service_score != null ? Number(r.customer_service_score) : null,
      applicableWeight: r.applicable_weight != null ? Number(r.applicable_weight) : 0,
      verdict: r.verdict,
      isEvaluable: r.is_evaluable,
      exclusionReason: r.exclusion_reason,
      summary: r.summary || null,
      linkedSessions: sessionsByPhone.get(r.customer_phone) || [],
      parameters: typeof r.parameters === 'string' ? JSON.parse(r.parameters) : r.parameters,
      complianceFlags: typeof r.compliance_flags === 'string' ? JSON.parse(r.compliance_flags) : (r.compliance_flags || []),
      complianceTripwire: Boolean(r.compliance_tripwire),
      complianceReason: r.compliance_reason,
      aiCoachingTip: r.ai_coaching_tip,
      totalMessages: r.total_messages || 0,
      firstResponseTimeSeconds: r.first_response_time_seconds,
      transcriptTurns: typeof r.transcript_turns === 'string' ? JSON.parse(r.transcript_turns) : (r.transcript_turns || []),
      chatClosedAt: r.chat_closed_at,
      scoredAt: r.scored_at,
      disputeStatus: r.dispute_status || 'none',
      disputeReason: r.dispute_reason,
      disputeComments: typeof r.dispute_comments === 'string' ? JSON.parse(r.dispute_comments) : (Array.isArray(r.dispute_comments) ? r.dispute_comments : []),
      tlOverrideNote: r.tl_override_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      isAm: Boolean(r.is_am),
      precedingRmName: r.preceding_rm_name || null,
    };
    return {
      ...chatObj,
      categories: detectPcgChatCategories(chatObj),
    };
  });

  if (categoryFilter && categoryFilter !== 'all' && categoryFilter !== 'not_scoreable') {
    if (categoryFilter === 'multiple') {
      chats = chats.filter((c) => c.categories.length > 1);
    } else {
      chats = chats.filter((c) => c.categories.includes(categoryFilter as any));
    }
  }

  // Dual chats count and co-handlers
  let dualChatsCount = 0;
  const dualCoHandlers: Array<{ name: string; count: number }> = [];
  try {
    const dualRows = await query<any>(`
      SELECT preceding_rm_name, rm_name, COUNT(*) as count
      FROM pcg_chat_evaluations
      WHERE preceding_rm_name IS NOT NULL AND TRIM(preceding_rm_name) != ''
        AND (is_tl = false OR is_tl IS NULL)
        AND verdict != 'NOT_SCOREABLE' AND is_evaluable IS NOT FALSE AND iqs_score IS NOT NULL
      GROUP BY preceding_rm_name, rm_name
    `);
    for (const d of dualRows) {
      const c = Number(d.count || 0);
      dualChatsCount += c;
      dualCoHandlers.push({
        name: `${d.preceding_rm_name} (RM) + ${d.rm_name} (AM)`,
        count: c,
      });
    }
  } catch {}

  return NextResponse.json({
    chats,
    total,
    totalPages,
    page,
    limit,
    summary: {
      totalCount: Number(summary.total_count || 0),
      avgIqs: summary.avg_iqs != null ? Number(summary.avg_iqs) : null,
      tripwireCount: Number(summary.tripwire_count || 0),
      avgFrtSeconds: summary.avg_frt != null ? Number(summary.avg_frt) : null,
      verdictCounts: {
        excellent: Number(summary.excellent_count || 0),
        meetsExpectations: Number(summary.meets_count || 0),
        coaching: Number(summary.coaching_count || 0),
        remediation: Number(summary.remediation_count || 0),
        notScoreable: Number(summary.not_scoreable_count || 0),
      }
    },
    sectionCounts,
    availableRms,
    availableTls,
    dualChatsCount,
    dualCoHandlers,
  });
});

export const POST = withLogging(ROUTE, async (req: NextRequest) => {
  let sessionUser: any = null;
  try {
    const { response, session } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;
    sessionUser = session?.user;
  } catch { }

  const body = await req.json();
  const { action, chatId, disputeReason, tlOverrideNote, resolution } = body;

  if (!chatId) {
    return NextResponse.json({ error: 'Missing chatId' }, { status: 400 });
  }

  if (action === 'submit_dispute') {
    const { challengedParams, agentNote, disputeReason, disputePayload } = body;

    let finalReason = '';
    if (disputePayload && typeof disputePayload === 'object') {
      finalReason = JSON.stringify(disputePayload);
    } else if (Array.isArray(challengedParams) && challengedParams.length > 0) {
      const summaryPrefix = `Parameters challenged: ${challengedParams.map((p: any) => {
        const name = typeof p === 'string' ? p : p.paramName || p.paramKey || p.name;
        const note = typeof p === 'object' && p.note ? ` (${p.note})` : '';
        return `${name}${note}`;
      }).join(', ')}. `;
      const summaryText = (summaryPrefix + (agentNote || disputeReason || '')).trim();

      finalReason = JSON.stringify({
        challengedParams,
        agentNote: (agentNote || disputeReason || '').trim(),
        summary: summaryText,
        submittedAt: new Date().toISOString(),
      });
    } else if (disputeReason) {
      finalReason = typeof disputeReason === 'object' ? JSON.stringify(disputeReason) : disputeReason;
    } else {
      finalReason = 'Disputed by RM';
    }

    await query(`
      UPDATE pcg_chat_evaluations
      SET dispute_status = 'pending',
          dispute_reason = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [finalReason, chatId]);

    return NextResponse.json({ success: true, message: 'Dispute submitted successfully' });
  }

  if (action === 'add_dispute_comment') {
    const { chatId, comment, content, authorName, authorRole } = body;
    const text = (comment || content || '').trim();
    if (!text) {
      return NextResponse.json({ error: 'Comment text cannot be empty' }, { status: 400 });
    }

    const reviewerRole = (authorRole && ['agent', 'tl', 'admin'].includes(authorRole))
      ? authorRole
      : (sessionUser?.role || 'agent');
    const reviewerName = authorName || sessionUser?.name || sessionUser?.email || (reviewerRole === 'agent' ? 'RM' : 'Team Lead');

    const newComment = {
      id: randomUUID(),
      authorName: reviewerName,
      authorRole: reviewerRole,
      content: text,
      createdAt: new Date().toISOString(),
    };

    const res = await query<any>(`
      UPDATE pcg_chat_evaluations
      SET dispute_comments = COALESCE(dispute_comments, '[]'::jsonb) || $1::jsonb,
          updated_at = NOW()
      WHERE id = $2
      RETURNING dispute_comments
    `, [JSON.stringify([newComment]), chatId]);

    const updatedComments = res[0]?.dispute_comments;

    return NextResponse.json({
      success: true,
      message: 'Comment added successfully',
      comment: newComment,
      disputeComments: typeof updatedComments === 'string' ? JSON.parse(updatedComments) : (updatedComments || []),
    });
  }

  if (action === 'resolve_dispute') {
    const status = resolution === 'overridden' ? 'overridden' : 'resolved';
    await query(`
      UPDATE pcg_chat_evaluations
      SET dispute_status = $1,
          tl_override_note = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [status, tlOverrideNote || '', chatId]);

    return NextResponse.json({ success: true, message: `Dispute marked as ${status}` });
  }

  if (action === 'override_evaluation') {
    if (sessionUser?.role === 'admin') {
      return NextResponse.json({ error: 'Evaluation override is restricted to Team Leads' }, { status: 403 });
    }

    const {
      parameters,
      complianceFlags,
      complianceTripwire,
      iqsScore,
      processScore,
      communicationScore,
      customerServiceScore,
      applicableWeight,
      verdict,
      disputeResolution,
    } = body;

    const reviewerName = sessionUser?.name || sessionUser?.email || 'Team Lead';
    const finalDisputeStatus = disputeResolution || 'none';
    const finalNote = tlOverrideNote
      ? (tlOverrideNote.startsWith(reviewerName) ? tlOverrideNote : `${reviewerName}: ${tlOverrideNote}`)
      : `Evaluation overridden by ${reviewerName}`;

    await query(`
      UPDATE pcg_chat_evaluations
      SET
        parameters = COALESCE($1::jsonb, parameters),
        compliance_flags = COALESCE($2::jsonb, compliance_flags),
        compliance_tripwire = COALESCE($3, compliance_tripwire),
        iqs_score = $4,
        process_score = $5,
        communication_score = $6,
        customer_service_score = $7,
        applicable_weight = COALESCE($8, applicable_weight),
        verdict = COALESCE($9, verdict),
        tl_override_note = $10,
        dispute_status = $11,
        status = 'reviewed',
        reviewed_by = $12,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $13
    `, [
      parameters ? JSON.stringify(parameters) : null,
      complianceFlags ? JSON.stringify(complianceFlags) : null,
      complianceTripwire != null ? Boolean(complianceTripwire) : null,
      iqsScore != null ? Number(iqsScore) : null,
      processScore != null ? Number(processScore) : null,
      communicationScore != null ? Number(communicationScore) : null,
      customerServiceScore != null ? Number(customerServiceScore) : null,
      applicableWeight != null ? Number(applicableWeight) : null,
      verdict || null,
      finalNote,
      finalDisputeStatus,
      reviewerName,
      chatId,
    ]);

    return NextResponse.json({
      success: true,
      message: 'Evaluation override submitted successfully',
      iqsScore,
      verdict,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
});

