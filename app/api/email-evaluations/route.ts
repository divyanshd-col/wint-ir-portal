/**
 * app/api/email-evaluations/route.ts
 *
 * REST API supporting Agent, Team Lead, and QA Views:
 * - Query email reply evaluations with filtering & aggregation
 * - QA Score Overrides & Feedback Notes
 * - Agent Dispute Raising & QA Dispute Resolution
 * - Manual on-demand evaluation & batch sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { randomUUID } from 'crypto';
import {
  storeAppendIQSFlag,
  storeUpdateIQSFlag,
  storeAppendFlagComment,
  storeAppendAuditEntry,
  type IQSFlag,
} from '@/lib/store';
import {
  evaluateSingleReplySync,
  submitPendingEmailBatchJob,
  collectAndProcessEmailBatchResults,
} from '@/lib/email/gemini-batch-evaluator';

async function getSubmitterName(emailOrName: string): Promise<string> {
  if (!emailOrName) return 'Yashvi Chajjer';
  const clean = emailOrName.trim();
  if (clean.toLowerCase() === 'qa reviewer' || clean.toLowerCase() === 'qa') {
    return 'Yashvi Chajjer';
  }
  try {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig();
    const configUser = config.users.find(u =>
      (u.email || u.username)?.toLowerCase() === clean.toLowerCase() ||
      (u.agentName || '').toLowerCase() === clean.toLowerCase()
    );
    if (configUser?.agentName) return configUser.agentName;
    const { getUserByEmail, getUserByName } = await import('@/lib/users');
    const dbUser = (await getUserByEmail(clean).catch(() => null)) || (await getUserByName(clean).catch(() => null));
    if (dbUser?.name) return dbUser.name;
  } catch {}
  if (clean.includes('@')) {
    const local = clean.split('@')[0];
    return local.split(/[._-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return clean;
}

async function getScopedAgentNamesForUser(
  userEmail: string,
  userName: string,
  userRole: string,
  isAdmin: boolean
): Promise<string[] | null> {
  if (isAdmin || userRole === 'admin' || userRole === 'quality') {
    return null; // Unrestricted access for Admin and QA
  }
  if (userRole === 'tl') {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig().catch(() => ({ users: [] }));
    const configUser = config.users?.find((u: any) =>
      (u.email || u.username || '').toLowerCase() === (userEmail || '').toLowerCase()
    );
    let tlAgentName = configUser?.agentName || '';
    if (!tlAgentName && userEmail) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(userEmail).catch(() => null);
      if (dbUser?.name) tlAgentName = dbUser.name;
    }
    if (!tlAgentName) tlAgentName = userName || userEmail;

    const { getAgentNamesByTL } = await import('@/lib/robylon/db');
    let scoped = await getAgentNamesByTL(tlAgentName);
    if (!scoped.length && userEmail && tlAgentName !== userEmail) {
      scoped = await getAgentNamesByTL(userEmail);
    }
    return scoped;
  }
  if (userRole === 'agent') {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig().catch(() => ({ users: [] }));
    const configUser = config.users?.find((u: any) =>
      (u.email || u.username || '').toLowerCase() === (userEmail || '').toLowerCase()
    );
    let selfAgentName = configUser?.agentName || '';
    if (!selfAgentName && userEmail) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(userEmail).catch(() => null);
      if (dbUser?.name) selfAgentName = dbUser.name;
    }
    if (!selfAgentName) selfAgentName = userName || (userEmail.includes('@') ? userEmail.split('@')[0] : userEmail);
    if (selfAgentName) {
      const matchedRows = await query<{ name: string }>(
        `SELECT name FROM agents WHERE LOWER(name) = LOWER($1) OR name ILIKE $1 || ' %' OR $1 ILIKE name || ' %'`,
        [selfAgentName]
      );
      return matchedRows.length ? matchedRows.map(r => r.name) : [selfAgentName];
    }
    return [];
  }
  return null;
}

async function getScopedDispositionsForUser(
  userEmail: string,
  userRole: string,
  isAdmin: boolean
): Promise<{ scopedDispositions: string[] | null; allDispositions: string[] }> {
  const { readConfig } = await import('@/lib/config');
  const config = await readConfig().catch(() => ({ users: [], qaDispositionMap: [] }));
  const emailLower = (userEmail || '').trim().toLowerCase();

  const allDispositions = Array.from(
    new Set((config.qaDispositionMap ?? []).flatMap((e: any) => e.dispositions || []))
  ).filter(Boolean) as string[];

  if (isAdmin || userRole === 'admin') {
    return { scopedDispositions: null, allDispositions };
  }

  if (userRole === 'quality') {
    const qaEntry = (config.qaDispositionMap ?? []).find((e: any) => (e.email || '').toLowerCase() === emailLower);
    const configUser = config.users?.find((u: any) => (u.email || u.username || '').toLowerCase() === emailLower);
    let userDisps: string[] | undefined = qaEntry?.dispositions ?? configUser?.assignedDispositions;

    if ((!userDisps || userDisps.length === 0) && userEmail) {
      try {
        const { getUserByEmail } = await import('@/lib/users');
        const dbUser = await getUserByEmail(userEmail).catch(() => null);
        if (dbUser?.assigned_dispositions && dbUser.assigned_dispositions.length > 0) {
          userDisps = dbUser.assigned_dispositions;
        }
      } catch {}
    }

    return {
      scopedDispositions: Array.isArray(userDisps) && userDisps.length > 0 ? userDisps : null,
      allDispositions,
    };
  }

  return { scopedDispositions: null, allDispositions };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const session = await getServerSession(authOptions).catch(() => null);
    const userRole = (session?.user as any)?.role || '';
    const userEmail = (((session?.user as any)?.email || '') as string).trim();
    const userName = (((session?.user as any)?.name || '') as string).trim();
    const isAdmin = userRole === 'admin' || Boolean((session?.user as any)?.isAdmin);

    const scopedAgentNames = await getScopedAgentNamesForUser(userEmail, userName, userRole, isAdmin);
    const { scopedDispositions, allDispositions } = await getScopedDispositionsForUser(userEmail, userRole, isAdmin);

    if (scopedAgentNames !== null && scopedAgentNames.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        total: 0,
        summary: {
          totalCount: 0,
          pendingCount: 0,
          pendingReviewCount: 0,
          reviewedCount: 0,
          unscoredCount: 0,
          completedCount: 0,
          avgScore: 0,
          complianceBreachCount: 0,
          activeDisputesCount: 0,
          reviewedDisputesCount: 0,
          qaDisputesCount: 0,
          tlPendingDisputesCount: 0,
          tlHistoryDisputesCount: 0,
          qaOverridesCount: 0,
        },
        agentBreakdown: [],
        availableAgents: [],
        assignedDispositions: [],
      });
    }

    const scopedLower = scopedAgentNames ? scopedAgentNames.map(a => a.trim().toLowerCase()) : [];

    const agentName = searchParams.get('agentName');
    const dispositionParam = searchParams.get('disposition');
    const status = searchParams.get('status');
    const reviewStatus = searchParams.get('reviewStatus');
    const tab = searchParams.get('tab');
    const maxScore = searchParams.get('maxScore'); // e.g. 85 for QA low scores
    const minScore = searchParams.get('minScore');
    const complianceFailed = searchParams.get('complianceFailed');
    const disputesOnly = searchParams.get('disputesOnly');
    const ticketId = searchParams.get('ticketId');
    const search = searchParams.get('search');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const disputeStatus = searchParams.get('disputeStatus');
    const disputeQueue = searchParams.get('disputeQueue'); // 'tl_pending' (raised, awaiting TL) | 'tl_history' (forwarded or decided)
    const limit = Math.min(Number(searchParams.get('limit') || 500), 1000);
    const offset = Number(searchParams.get('offset') || 0);

    let effectiveDispositions: string[] | null = null;
    let singleDisposition: string | null = null;

    if (dispositionParam && dispositionParam !== 'all') {
      const dTrimmed = dispositionParam.trim();
      const dLower = dTrimmed.toLowerCase();
      if (scopedDispositions !== null) {
        const allowed = scopedDispositions.map(d => d.trim().toLowerCase());
        if (allowed.includes(dLower)) {
          singleDisposition = dTrimmed;
        } else {
          singleDisposition = '__FORBIDDEN__';
        }
      } else {
        singleDisposition = dTrimmed;
      }
    } else if (scopedDispositions !== null) {
      effectiveDispositions = scopedDispositions;
    }

    let whereClauses: string[] = ['1=1'];
    const params: any[] = [];

    if (agentName) {
      const reqLower = agentName.trim().toLowerCase();
      const isAllowed = !scopedAgentNames || scopedLower.includes(reqLower) || scopedLower.some(n => n.startsWith(reqLower) || reqLower.startsWith(n));
      if (isAllowed) {
        params.push(agentName.trim());
        whereClauses.push(`TRIM(e.agent_name) ILIKE $${params.length}`);
      } else {
        whereClauses.push('1 = 0');
      }
    } else if (scopedAgentNames) {
      params.push(scopedLower);
      whereClauses.push(`LOWER(TRIM(e.agent_name)) = ANY($${params.length}::text[])`);
    }

    // Disposition scoping & filtering
    if (singleDisposition === '__FORBIDDEN__') {
      whereClauses.push('1 = 0');
    } else if (singleDisposition) {
      params.push(singleDisposition.toLowerCase());
      whereClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = $${params.length}`);
    } else if (effectiveDispositions) {
      const lowerDisps = effectiveDispositions.map(d => d.trim().toLowerCase());
      params.push(lowerDisps);
      const dispIdx = params.length;
      if (tab === 'reviewed') {
        params.push(userEmail.toLowerCase());
        whereClauses.push(`(LOWER(TRIM(COALESCE(intent.val, ''))) = ANY($${dispIdx}::text[]) OR LOWER(COALESCE(e.reviewed_by, '')) = $${params.length})`);
      } else {
        whereClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = ANY($${dispIdx}::text[])`);
      }
    }

    // QA Review workflow filtering
    if (tab === 'pending' || reviewStatus === 'pending' || status === 'Pending_Review') {
      // Completed AI evaluation, pending QA review
      whereClauses.push(`e.evaluation_status = 'Completed' AND (e.review_status = 'pending' OR e.review_status IS NULL)`);
    } else if (tab === 'reviewed' || reviewStatus === 'reviewed' || status === 'Reviewed') {
      // Finalized & submitted by QA
      whereClauses.push(`e.review_status = 'reviewed'`);
    } else if (tab === 'unscored' || reviewStatus === 'unscored' || status === 'Unscored') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden: Unscored emails section is admin only' }, { status: 403 });
      }
      // Ingested, awaiting AI batch or sync evaluation
      whereClauses.push(`e.evaluation_status IN ('Pending', 'In_Batch')`);
    } else if (status) {
      params.push(status);
      whereClauses.push(`e.evaluation_status = $${params.length}`);
    }

    if (ticketId) {
      params.push(ticketId);
      whereClauses.push(`e.ticket_id = $${params.length}`);
    }

    if (fromDate) {
      params.push(fromDate);
      whereClauses.push(`e.sent_at >= $${params.length}`);
    }

    if (toDate) {
      const toValue = toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`;
      params.push(toValue);
      whereClauses.push(`e.sent_at <= $${params.length}`);
    }

    if (maxScore !== null && maxScore !== undefined && maxScore !== '') {
      params.push(Number(maxScore));
      whereClauses.push(`COALESCE(e.qa_override_score, e.quality_score) <= $${params.length}`);
    }

    if (minScore !== null && minScore !== undefined && minScore !== '') {
      params.push(Number(minScore));
      whereClauses.push(`COALESCE(e.qa_override_score, e.quality_score) >= $${params.length}`);
    }

    if (complianceFailed === 'true') {
      whereClauses.push(`(e.compliance_passed = FALSE OR array_length(e.compliance_issues, 1) > 0)`);
    }

    if (disputeQueue === 'tl_pending') {
      whereClauses.push(`e.dispute_status = 'Raised'`);
    } else if (disputeQueue === 'tl_history') {
      whereClauses.push(`e.dispute_status IN ('Under_Review', 'Resolved', 'Rejected', 'TL_Resolved')`);
    } else if (tab === 'disputes') {
      // QA queue: only disputes a TL has forwarded (like chats); Raised ones are still with the TL.
      whereClauses.push(`e.dispute_status = 'Under_Review'`);
    } else if (disputesOnly === 'true') {
      whereClauses.push(`e.dispute_status IN ('Raised', 'Under_Review')`);
    } else if (disputeStatus === 'pending') {
      whereClauses.push(`e.dispute_status IN ('Raised', 'Under_Review')`);
    } else if (disputeStatus === 'reviewed') {
      whereClauses.push(`e.dispute_status IN ('Resolved', 'Rejected', 'TL_Resolved')`);
    }

    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(
        `(e.ticket_id ILIKE $${params.length} OR e.agent_reply_text ILIKE $${params.length} OR e.customer_message ILIKE $${params.length} OR c.subject_line ILIKE $${params.length} OR c.customer_email ILIKE $${params.length})`
      );
    }

    const whereSQL = whereClauses.join(' AND ');

    // 1. Fetch evaluated items with conversation subject & review metadata
    const itemsQuery = `
      SELECT 
        e.*,
        c.chat_id,
        c.subject_line,
        c.customer_email,
        c.customer_phone,
        c.status AS conversation_status,
        c.merged_into_ticket_id,
        c.thread_summary,
        intent.val AS intent_l1,
        COALESCE(e.qa_override_score, e.quality_score) AS effective_score,
        COALESCE(e.reviewed_by, ag.qa_name) AS qa_name
      FROM email_reply_evaluations e
      JOIN email_conversations c ON e.ticket_id = c.id
      LEFT JOIN agents ag ON LOWER(ag.name) = LOWER(e.agent_name)
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
        FROM robylon_webhook_payloads w,
             jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
        WHERE (w.chat_id = c.chat_id OR w.chat_id = c.id)
          AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
        ORDER BY w.received_at DESC LIMIT 1
      ) intent ON true
      WHERE ${whereSQL}
      ORDER BY e.sent_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const items = await query<any>(itemsQuery, params);

    // Attach internal notes from robylon_webhook_payloads for the retrieved items
    if (items.length > 0) {
      const chatIds = Array.from(
        new Set(items.flatMap((i: any) => [i.chat_id, i.ticket_id].filter(Boolean)))
      );

      if (chatIds.length > 0) {
        try {
          const noteRows = await query<any>(
            `SELECT 
               w.chat_id,
               COALESCE(
                 w.payload->'human_agent_info'->>'name',
                 w.payload->'data'->'message'->>'sender',
                 w.payload->'data'->'message'->>'from_email',
                 'Internal Note'
               ) AS sender,
               COALESCE(
                 w.payload->'data'->'message'->>'content',
                 w.payload->'data'->>'content',
                 w.payload->>'content'
               ) AS content,
               COALESCE(
                 (w.payload->'data'->'message'->>'created_at')::timestamptz,
                 w.received_at
               ) AS created_at
             FROM robylon_webhook_payloads w
             WHERE w.event_type = 'INTERNAL_NOTE_ADDED'
               AND w.chat_id = ANY($1::text[])
             ORDER BY created_at ASC`,
            [chatIds]
          );

          const notesByChatId: Record<string, any[]> = {};
          for (const row of noteRows) {
            const key = String(row.chat_id);
            if (!notesByChatId[key]) notesByChatId[key] = [];
            if (row.content && String(row.content).trim()) {
              notesByChatId[key].push({
                sender: (row.sender || 'Agent').trim(),
                content: String(row.content).trim(),
                created_at: row.created_at,
              });
            }
          }

          for (const item of items) {
            item.internal_notes =
              notesByChatId[String(item.chat_id)] ||
              notesByChatId[String(item.ticket_id)] ||
              [];
          }
        } catch (err) {
          console.error('[email-evaluations] Error attaching internal notes:', err);
        }
      }
    }

    // The cards (totals, tab counts, per-agent breakdown) follow the same sent_at range as the list.
    const rangeClauses: string[] = [];
    const rangeParams: any[] = [];
    if (fromDate) {
      rangeParams.push(fromDate);
      rangeClauses.push(`e.sent_at >= $${rangeParams.length}`);
    }
    if (toDate) {
      rangeParams.push(toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`);
      rangeClauses.push(`e.sent_at <= $${rangeParams.length}`);
    }

    // 2. Fetch Aggregated Statistics & Tab Counts for Dashboard
    // Summary cards follow the date range, agent scoping/filter, and disposition scoping/filter
    const statsClauses: string[] = [...rangeClauses];
    const statsParams: any[] = [...rangeParams];

    if (agentName) {
      const reqLower = agentName.trim().toLowerCase();
      const isAllowed = !scopedAgentNames || scopedLower.includes(reqLower) || scopedLower.some(n => n.startsWith(reqLower) || reqLower.startsWith(n));
      if (isAllowed) {
        statsParams.push(agentName.trim());
        statsClauses.push(`TRIM(e.agent_name) ILIKE $${statsParams.length}`);
      } else {
        statsClauses.push('1 = 0');
      }
    } else if (scopedAgentNames) {
      statsParams.push(scopedLower);
      statsClauses.push(`LOWER(TRIM(e.agent_name)) = ANY($${statsParams.length}::text[])`);
    }

    const hasDispositionFilter = singleDisposition !== null || effectiveDispositions !== null;
    let statsFrom = 'FROM email_reply_evaluations e';
    if (hasDispositionFilter) {
      statsFrom = `
        FROM email_reply_evaluations e
        JOIN email_conversations c ON e.ticket_id = c.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
          FROM robylon_webhook_payloads w,
               jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
          WHERE (w.chat_id = c.chat_id OR w.chat_id = c.id)
            AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
          ORDER BY w.received_at DESC LIMIT 1
        ) intent ON true
      `;

      if (singleDisposition === '__FORBIDDEN__') {
        statsClauses.push('1 = 0');
      } else if (singleDisposition) {
        statsParams.push(singleDisposition.toLowerCase());
        statsClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = $${statsParams.length}`);
      } else if (effectiveDispositions) {
        const lowerDisps = effectiveDispositions.map(d => d.trim().toLowerCase());
        statsParams.push(lowerDisps);
        statsClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = ANY($${statsParams.length}::text[])`);
      }
    }

    const statsWhere = statsClauses.length ? `WHERE ${statsClauses.join(' AND ')}` : '';
    const statsQuery = `
      SELECT 
        COUNT(*)::int AS total_count,
        COUNT(CASE WHEN e.evaluation_status = 'Completed' AND (e.review_status = 'pending' OR e.review_status IS NULL) THEN 1 END)::int AS pending_review_count,
        COUNT(CASE WHEN e.review_status = 'reviewed' THEN 1 END)::int AS reviewed_count,
        COUNT(CASE WHEN e.evaluation_status IN ('Pending', 'In_Batch') THEN 1 END)::int AS unscored_count,
        COUNT(CASE WHEN e.evaluation_status = 'Completed' THEN 1 END)::int AS completed_count,
        ROUND(AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE e.evaluation_status = 'Completed'), 2) AS avg_score,
        COUNT(CASE WHEN e.compliance_passed = FALSE THEN 1 END)::int AS compliance_breach_count,
        COUNT(CASE WHEN e.dispute_status IN ('Raised', 'Under_Review') THEN 1 END)::int AS active_disputes_count,
        COUNT(CASE WHEN e.dispute_status IN ('Resolved', 'Rejected', 'TL_Resolved') THEN 1 END)::int AS reviewed_disputes_count,
        COUNT(CASE WHEN e.dispute_status = 'Under_Review' THEN 1 END)::int AS qa_disputes_count,
        COUNT(CASE WHEN e.dispute_status = 'Raised' THEN 1 END)::int AS tl_pending_disputes_count,
        COUNT(CASE WHEN e.dispute_status IN ('Under_Review', 'Resolved', 'Rejected', 'TL_Resolved') THEN 1 END)::int AS tl_history_disputes_count,
        COUNT(CASE WHEN e.qa_override_score IS NOT NULL THEN 1 END)::int AS qa_overrides_count
      ${statsFrom}
      ${statsWhere}
    `;
    const statsRes = await query(statsQuery, statsParams);
    const summary = statsRes?.[0] || {};

    // Calculate total all-time pending review count respecting agent and disposition scoping
    let totalPendingCount = Number(summary.pending_review_count || 0);
    if (rangeClauses.length > 0) {
      const scopeClauses: string[] = ["e.evaluation_status = 'Completed'", "(e.review_status = 'pending' OR e.review_status IS NULL)"];
      const scopeParams: any[] = [];
      if (agentName) {
        const reqLower = agentName.trim().toLowerCase();
        const isAllowed = !scopedAgentNames || scopedLower.includes(reqLower) || scopedLower.some(n => n.startsWith(reqLower) || reqLower.startsWith(n));
        if (isAllowed) {
          scopeParams.push(agentName.trim());
          scopeClauses.push(`TRIM(e.agent_name) ILIKE $${scopeParams.length}`);
        } else {
          scopeClauses.push('1 = 0');
        }
      } else if (scopedAgentNames) {
        scopeParams.push(scopedLower);
        scopeClauses.push(`LOWER(TRIM(e.agent_name)) = ANY($${scopeParams.length}::text[])`);
      }
      if (hasDispositionFilter) {
        if (singleDisposition === '__FORBIDDEN__') {
          scopeClauses.push('1 = 0');
        } else if (singleDisposition) {
          scopeParams.push(singleDisposition.toLowerCase());
          scopeClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = $${scopeParams.length}`);
        } else if (effectiveDispositions) {
          const lowerDisps = effectiveDispositions.map(d => d.trim().toLowerCase());
          scopeParams.push(lowerDisps);
          scopeClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = ANY($${scopeParams.length}::text[])`);
        }
      }
      const totalPendingQuery = `SELECT COUNT(*)::int AS total_pending ${statsFrom} WHERE ${scopeClauses.join(' AND ')}`;
      const totalPendingRes = await query(totalPendingQuery, scopeParams);
      totalPendingCount = Number(totalPendingRes?.[0]?.total_pending || 0);
    }

    // 3. Member-Level Breakdown for Team Lead View
    const tlBreakdownClauses: string[] = ['e.agent_name IS NOT NULL'];
    const tlBreakdownParams: any[] = [];
    if (fromDate) {
      tlBreakdownParams.push(fromDate);
      tlBreakdownClauses.push(`e.sent_at >= $${tlBreakdownParams.length}`);
    }
    if (toDate) {
      const toValue = toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`;
      tlBreakdownParams.push(toValue);
      tlBreakdownClauses.push(`e.sent_at <= $${tlBreakdownParams.length}`);
    }
    if (scopedAgentNames) {
      tlBreakdownParams.push(scopedLower);
      tlBreakdownClauses.push(`LOWER(TRIM(e.agent_name)) = ANY($${tlBreakdownParams.length}::text[])`);
    }

    let tlBreakdownFrom = 'FROM email_reply_evaluations e';
    if (hasDispositionFilter) {
      tlBreakdownFrom = `
        FROM email_reply_evaluations e
        JOIN email_conversations c ON e.ticket_id = c.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
          FROM robylon_webhook_payloads w,
               jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
          WHERE (w.chat_id = c.chat_id OR w.chat_id = c.id)
            AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
          ORDER BY w.received_at DESC LIMIT 1
        ) intent ON true
      `;

      if (singleDisposition === '__FORBIDDEN__') {
        tlBreakdownClauses.push('1 = 0');
      } else if (singleDisposition) {
        tlBreakdownParams.push(singleDisposition.toLowerCase());
        tlBreakdownClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = $${tlBreakdownParams.length}`);
      } else if (effectiveDispositions) {
        const lowerDisps = effectiveDispositions.map(d => d.trim().toLowerCase());
        tlBreakdownParams.push(lowerDisps);
        tlBreakdownClauses.push(`LOWER(TRIM(COALESCE(intent.val, ''))) = ANY($${tlBreakdownParams.length}::text[])`);
      }
    }

    const tlBreakdownWhere = `WHERE ${tlBreakdownClauses.join(' AND ')}`;

    const tlBreakdownQuery = `
      SELECT 
        e.agent_name,
        COUNT(*)::int AS total_replies,
        ROUND(AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE e.evaluation_status = 'Completed'), 1) AS avg_score,
        COUNT(CASE WHEN e.compliance_passed = FALSE THEN 1 END)::int AS compliance_errors,
        COUNT(CASE WHEN e.dispute_status IN ('Raised', 'Under_Review') THEN 1 END)::int AS disputes_raised,
        COUNT(CASE WHEN e.qa_override_score IS NOT NULL THEN 1 END)::int AS overrides_count
      ${tlBreakdownFrom}
      ${tlBreakdownWhere}
      GROUP BY e.agent_name
      ORDER BY total_replies DESC
    `;
    const agentBreakdown = await query(tlBreakdownQuery, tlBreakdownParams);

    const mappedItems = await Promise.all(
      (items || []).map(async (item: any) => {
        let reviewer = item.reviewed_by;
        if (reviewer) {
          reviewer = await getSubmitterName(reviewer);
        }
        let qaName = item.qa_name;
        if (qaName) {
          qaName = await getSubmitterName(qaName);
        }
        return {
          ...item,
          reviewed_by: reviewer,
          qa_name: qaName || reviewer || 'Yashvi Chajjer',
        };
      })
    );

    return NextResponse.json({
      ok: true,
      items: mappedItems,
      summary: {
        totalCount: Number(summary.total_count || 0),
        pendingCount: Number(summary.pending_review_count || 0),
        pendingReviewCount: Number(summary.pending_review_count || 0),
        totalPendingReviewCount: Number(totalPendingCount || 0),
        reviewedCount: Number(summary.reviewed_count || 0),
        unscoredCount: isAdmin ? Number(summary.unscored_count || 0) : 0,
        completedCount: Number(summary.completed_count || 0),
        avgScore: Number(summary.avg_score || 0),
        complianceBreachCount: Number(summary.compliance_breach_count || 0),
        activeDisputesCount: Number(summary.active_disputes_count || 0),
        reviewedDisputesCount: Number(summary.reviewed_disputes_count || 0),
        qaDisputesCount: Number(summary.qa_disputes_count || 0),
        tlPendingDisputesCount: Number(summary.tl_pending_disputes_count || 0),
        tlHistoryDisputesCount: Number(summary.tl_history_disputes_count || 0),
        qaOverridesCount: Number(summary.qa_overrides_count || 0),
      },
      agentBreakdown: agentBreakdown || [],
      availableAgents: scopedAgentNames || (agentBreakdown || []).map((a: any) => a.agent_name),
      assignedDispositions: scopedDispositions || allDispositions,
    });
  } catch (err: any) {
    console.error('[api/email-evaluations] Error:', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action;

    // Action 1: QA submits evaluation review or saves override
    if (action === 'submit_review' || action === 'qa_override') {
      const { messageId, overrideScore, score, qaNotes, parameterScores, compliancePassed, complianceIssues } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }

      const session = await getServerSession(authOptions).catch(() => null);
      const sessionUser = session?.user as any;
      const rawReviewer = sessionUser?.name && !sessionUser.name.includes('@')
        ? sessionUser.name
        : (sessionUser?.email || body.reviewedBy || '');
      const reviewerName = await getSubmitterName(rawReviewer);
      const reviewerEmail = sessionUser?.email || '';
      const role = sessionUser?.role || 'quality';

      const finalScore = score !== undefined && score !== null
        ? Number(score)
        : (overrideScore !== undefined && overrideScore !== null ? Number(overrideScore) : null);

      // Check if this evaluation has an active dispute
      const evalRows = await query<any>(
        `SELECT id, ticket_id, message_id, flag_id, dispute_status, agent_name FROM email_reply_evaluations WHERE message_id = $1`,
        [messageId]
      );
      const existing = evalRows?.[0];
      if (!existing) {
        return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
      }

      if (role === 'quality' && !sessionUser?.isAdmin) {
        const { scopedDispositions } = await getScopedDispositionsForUser(reviewerEmail, role, false);
        if (scopedDispositions !== null && scopedDispositions.length > 0) {
          const intentRows = await query<any>(`
            SELECT intent.val AS intent_l1
            FROM email_reply_evaluations e
            JOIN email_conversations c ON e.ticket_id = c.id
            LEFT JOIN LATERAL (
              SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
              FROM robylon_webhook_payloads w,
                   jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
              WHERE (w.chat_id = c.chat_id OR w.chat_id = c.id)
                AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
              ORDER BY w.received_at DESC LIMIT 1
            ) intent ON true
            WHERE e.message_id = $1
          `, [messageId]);
          const itemIntent = (intentRows[0]?.intent_l1 || '').trim().toLowerCase();
          const allowed = scopedDispositions.map(d => d.trim().toLowerCase());
          if (itemIntent && !allowed.includes(itemIntent)) {
            return NextResponse.json({ error: 'Forbidden: You are not assigned to this email disposition' }, { status: 403 });
          }
        }
      }

      const wasDispute = existing && (existing.dispute_status === 'Under_Review' || existing.dispute_status === 'Raised');

      await query(
        `UPDATE email_reply_evaluations
         SET qa_override_score = $1,
             qa_notes = COALESCE($2, qa_notes),
             parameter_scores = CASE WHEN $3::text IS NOT NULL THEN COALESCE(parameter_scores, '{}'::jsonb) || $3::jsonb ELSE parameter_scores END,
             review_status = 'reviewed',
             dispute_status = CASE WHEN dispute_status IN ('Under_Review', 'Raised') THEN 'Resolved' ELSE dispute_status END,
             reviewed_by = $4,
             reviewed_at = NOW(),
             compliance_passed = COALESCE($5, compliance_passed),
             compliance_issues = COALESCE($6, compliance_issues),
             updated_at = NOW()
         WHERE message_id = $7`,
        [
          finalScore,
          qaNotes || null,
          parameterScores ? JSON.stringify(parameterScores) : null,
          reviewerName,
          compliancePassed !== undefined ? Boolean(compliancePassed) : null,
          complianceIssues ? complianceIssues : null,
          messageId,
        ]
      );

      // If resolving an active dispute, synchronize the linked iqs_flag and append discussion/audit entries
      if (wasDispute && existing?.flag_id) {
        const resolutionNote = qaNotes || 'Dispute reviewed and resolved by QA';

        await storeUpdateIQSFlag(existing.flag_id, {
          status: 'reviewed',
          reviewedBy: reviewerName,
          reviewedAt: new Date().toISOString(),
          reviewNote: resolutionNote,
          updatedAt: new Date().toISOString(),
        });

        await storeAppendFlagComment({
          id: randomUUID(),
          flagId: existing.flag_id,
          authorEmail: reviewerEmail,
          authorName: reviewerName,
          role: 'quality',
          content: `QA Review Submitted: Dispute resolved${finalScore !== null ? ` with score ${finalScore}%` : ''}${qaNotes ? ` - Notes: ${qaNotes}` : ''}`,
          createdAt: new Date().toISOString(),
        });

        await storeAppendAuditEntry({
          id: randomUUID(),
          action: 'dispute_resolved',
          chatId: existing.ticket_id || messageId,
          actorEmail: reviewerEmail,
          actorRole: role,
          ts: new Date().toISOString(),
          meta: { flagId: existing.flag_id, messageId, decision: 'Resolved', newScore: finalScore, notes: qaNotes, reviewerName },
        } as any);
      }

      return NextResponse.json({
        ok: true,
        message: 'Review submitted successfully',
        wasDispute: Boolean(wasDispute),
      });
    }

    // Action 2: Agent or TL raises a dispute
    if (action === 'raise_dispute') {
      const { messageId, notes, challengedParams } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }

      const session = await getServerSession(authOptions).catch(() => null);
      const email = ((session?.user as any)?.email || session?.user?.name || '') as string;
      const role = ((session?.user as any)?.role || 'agent') as string;
      const isTL = role === 'tl' || body.raisedByRole === 'tl';
      const effectiveRaisedByRole = isTL ? 'tl' : 'ir';
      const initialDisputeStatus = isTL ? 'Under_Review' : 'Raised';
      const initialFlagStatus = isTL ? 'tl_forwarded' : 'pending';

      const submitterName = await getSubmitterName(email);

      // Fetch existing evaluation
      const evalRows = await query<any>(
        `SELECT id, ticket_id, message_id, agent_name, flag_id FROM email_reply_evaluations WHERE message_id = $1`,
        [messageId]
      );
      if (!evalRows.length) {
        return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
      }
      const existing = evalRows[0];
      const flagId = existing.flag_id || randomUUID();
      const paramsArray = Array.isArray(challengedParams) ? challengedParams : [];

      const flag: IQSFlag = {
        id: flagId,
        scoreId: messageId,
        chatId: existing.ticket_id || messageId,
        messageId,
        agentName: existing.agent_name || submitterName,
        agentEmail: email,
        agentNote: notes || '',
        challengedParams: paramsArray,
        flaggedAt: new Date().toISOString(),
        raisedByRole: effectiveRaisedByRole,
        paramCategory: 'qa',
        status: initialFlagStatus,
      };

      await storeAppendIQSFlag(flag);

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = $1,
             dispute_notes = $2,
             flag_id = $3,
             challenged_params = $4::jsonb,
             updated_at = NOW()
         WHERE message_id = $5`,
        [initialDisputeStatus, notes || 'Dispute raised regarding evaluation.', flagId, JSON.stringify(paramsArray), messageId]
      );

      if (isTL) {
        const agentRows = await query<any>(`SELECT qa_name FROM agents WHERE name ILIKE $1`, [existing.agent_name]);
        const targetQa = agentRows[0]?.qa_name ? await getSubmitterName(agentRows[0].qa_name) : 'Yashvi Chajjer';

        await storeAppendFlagComment({
          id: randomUUID(),
          flagId,
          authorEmail: email,
          authorName: submitterName,
          role: 'tl',
          content: notes ? `Forwarded to ${targetQa}: ${notes}` : `Forwarded to ${targetQa}`,
          createdAt: new Date().toISOString(),
        });
      }

      const auditAction = isTL ? 'tl_dispute_raised' : 'ir_dispute_raised';
      await storeAppendAuditEntry({
        id: randomUUID(),
        action: auditAction,
        chatId: existing.ticket_id || messageId,
        actorEmail: email,
        actorRole: role,
        ts: new Date().toISOString(),
        meta: { flagId, messageId, challengedParams: paramsArray, agentName: existing.agent_name, submitterName },
      } as any);

      return NextResponse.json({ ok: true, flagId, message: 'Dispute submitted successfully' });
    }

    // Action 2b: Agent cancels a pending dispute
    if (action === 'cancel_dispute') {
      const { messageId } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }

      const session = await getServerSession(authOptions).catch(() => null);
      const email = ((session?.user as any)?.email || session?.user?.name || '') as string;
      const role = ((session?.user as any)?.role || 'agent') as string;

      const evalRows = await query<any>(
        `SELECT id, ticket_id, message_id, dispute_status, flag_id FROM email_reply_evaluations WHERE message_id = $1`,
        [messageId]
      );
      if (!evalRows.length) {
        return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
      }
      const existing = evalRows[0];
      if (existing.dispute_status !== 'Raised') {
        return NextResponse.json({ error: 'Can only cancel pending disputes awaiting TL review' }, { status: 400 });
      }

      if (existing.flag_id) {
        await storeUpdateIQSFlag(existing.flag_id, {
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = 'None',
             dispute_notes = NULL,
             challenged_params = '[]'::jsonb,
             updated_at = NOW()
         WHERE message_id = $1`,
        [messageId]
      );

      await storeAppendAuditEntry({
        id: randomUUID(),
        action: 'dispute_cancelled',
        chatId: existing.ticket_id || messageId,
        actorEmail: email,
        actorRole: role,
        ts: new Date().toISOString(),
        meta: { flagId: existing.flag_id, messageId },
      } as any);

      return NextResponse.json({ ok: true, message: 'Dispute cancelled successfully' });
    }

    // Action 3: QA resolves/rejects dispute (Page 7)
    if (action === 'resolve_dispute') {
      const { messageId, decision, notes, newScore, parameterScores } = body; // decision: 'Resolved' | 'Rejected'
      if (!messageId || !decision) {
        return NextResponse.json({ error: 'messageId and decision are required' }, { status: 400 });
      }

      const session = await getServerSession(authOptions).catch(() => null);
      const sessionUser = session?.user as any;
      const rawReviewer = sessionUser?.name && !sessionUser.name.includes('@')
        ? sessionUser.name
        : (sessionUser?.email || body.reviewedBy || '');
      const reviewerName = await getSubmitterName(rawReviewer);
      const reviewerEmail = sessionUser?.email || '';
      const role = sessionUser?.role || 'quality';

      const evalRows = await query<any>(
        `SELECT id, ticket_id, message_id, flag_id, quality_score, qa_override_score FROM email_reply_evaluations WHERE message_id = $1`,
        [messageId]
      );
      if (!evalRows.length) {
        return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
      }
      const existing = evalRows[0];

      if (role === 'quality' && !sessionUser?.isAdmin) {
        const { scopedDispositions } = await getScopedDispositionsForUser(reviewerEmail, role, false);
        if (scopedDispositions !== null && scopedDispositions.length > 0) {
          const intentRows = await query<any>(`
            SELECT intent.val AS intent_l1
            FROM email_reply_evaluations e
            JOIN email_conversations c ON e.ticket_id = c.id
            LEFT JOIN LATERAL (
              SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
              FROM robylon_webhook_payloads w,
                   jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
              WHERE (w.chat_id = c.chat_id OR w.chat_id = c.id)
                AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
              ORDER BY w.received_at DESC LIMIT 1
            ) intent ON true
            WHERE e.message_id = $1
          `, [messageId]);
          const itemIntent = (intentRows[0]?.intent_l1 || '').trim().toLowerCase();
          const allowed = scopedDispositions.map(d => d.trim().toLowerCase());
          if (itemIntent && !allowed.includes(itemIntent)) {
            return NextResponse.json({ error: 'Forbidden: You are not assigned to this email disposition' }, { status: 403 });
          }
        }
      }

      const flagId = existing.flag_id;

      const updateScore = newScore !== undefined && newScore !== null ? Number(newScore) : null;
      const finalNote = notes || `Dispute marked as ${decision}`;

      if (flagId) {
        await storeUpdateIQSFlag(flagId, {
          status: 'reviewed',
          reviewedBy: reviewerName,
          reviewedAt: new Date().toISOString(),
          reviewNote: finalNote,
          updatedAt: new Date().toISOString(),
        });

        await storeAppendFlagComment({
          id: randomUUID(),
          flagId,
          authorEmail: reviewerEmail,
          authorName: reviewerName,
          role: 'quality',
          content: `QA Decision: ${decision}${notes ? ` - ${notes}` : ''}`,
          createdAt: new Date().toISOString(),
        });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = $1::varchar,
             qa_notes = COALESCE(qa_notes, '') || ' [Dispute Decision: ' || $1::text || ' - ' || $2::text || ']',
             qa_override_score = CASE WHEN $3::numeric IS NOT NULL THEN $3::numeric ELSE qa_override_score END,
             parameter_scores = CASE WHEN $4::text IS NOT NULL THEN COALESCE(parameter_scores, '{}'::jsonb) || $4::jsonb ELSE parameter_scores END,
             review_status = 'reviewed',
             reviewed_by = COALESCE($5, reviewed_by),
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE message_id = $6`,
        [
          decision,
          notes || '',
          updateScore,
          parameterScores ? JSON.stringify(parameterScores) : null,
          reviewerName,
          messageId,
        ]
      );

      await storeAppendAuditEntry({
        id: randomUUID(),
        action: 'dispute_resolved',
        chatId: existing.ticket_id || messageId,
        actorEmail: reviewerEmail,
        actorRole: role,
        ts: new Date().toISOString(),
        meta: { flagId, messageId, decision, newScore: updateScore, notes },
      } as any);

      return NextResponse.json({ ok: true, message: `Dispute marked as ${decision}` });
    }

    // Action 3b: TL forwards dispute to QA
    if (action === 'forward_dispute') {
      const { messageId, notes } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }

      const session = await getServerSession(authOptions).catch(() => null);
      const email = ((session?.user as any)?.email || session?.user?.name || '') as string;
      const role = ((session?.user as any)?.role || 'tl') as string;
      const submitterName = await getSubmitterName(email);

      const evalRows = await query<any>(
        `SELECT id, ticket_id, message_id, flag_id, dispute_notes, challenged_params, agent_name FROM email_reply_evaluations WHERE message_id = $1`,
        [messageId]
      );
      if (!evalRows.length) {
        return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
      }
      const existing = evalRows[0];

      if (role === 'tl') {
        const tlAgents = await getScopedAgentNamesForUser(email, submitterName, 'tl', false);
        if (tlAgents && tlAgents.length > 0) {
          const lowerTL = tlAgents.map(a => a.trim().toLowerCase());
          if (!lowerTL.includes((existing.agent_name || '').trim().toLowerCase())) {
            return NextResponse.json({ error: 'Forbidden: You can only act on disputes for your assigned agents' }, { status: 403 });
          }
        }
      }

      let flagId = existing.flag_id;

      if (!flagId) {
        // Backfill flag if it didn't exist
        flagId = randomUUID();
        const flag: IQSFlag = {
          id: flagId,
          scoreId: messageId,
          chatId: existing.ticket_id || messageId,
          messageId,
          agentName: existing.agent_name || 'Agent',
          agentEmail: email,
          agentNote: existing.dispute_notes || '',
          challengedParams: existing.challenged_params || [],
          flaggedAt: new Date().toISOString(),
          raisedByRole: 'ir',
          paramCategory: 'qa',
          status: 'tl_forwarded',
        };
        await storeAppendIQSFlag(flag);
      } else {
        await storeUpdateIQSFlag(flagId, {
          status: 'tl_forwarded',
          updatedAt: new Date().toISOString(),
        });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = 'Under_Review',
             flag_id = $1,
             dispute_notes = COALESCE(dispute_notes, '') || CASE WHEN $2::text IS NOT NULL AND $2::text != '' THEN ' [TL Forward: ' || $2 || ']' ELSE '' END,
             updated_at = NOW()
         WHERE message_id = $3`,
        [flagId, notes || null, messageId]
      );

      const agentRows = await query<any>(`SELECT qa_name FROM agents WHERE name ILIKE $1`, [existing.agent_name]);
      const targetQa = agentRows[0]?.qa_name ? await getSubmitterName(agentRows[0].qa_name) : 'Yashvi Chajjer';

      await storeAppendFlagComment({
        id: randomUUID(),
        flagId,
        authorEmail: email,
        authorName: submitterName,
        role: 'tl',
        content: notes?.trim() ? `Forwarded to ${targetQa}: ${notes.trim()}` : `Forwarded to ${targetQa}`,
        createdAt: new Date().toISOString(),
      });

      await storeAppendAuditEntry({
        id: randomUUID(),
        action: 'tl_forwarded_dispute',
        chatId: existing.ticket_id || messageId,
        actorEmail: email,
        actorRole: role,
        ts: new Date().toISOString(),
        meta: { flagId, messageId, notes },
      } as any);

      return NextResponse.json({ ok: true, flagId, message: 'Dispute forwarded to QA successfully' });
    }

    // Action 3c: TL resolves a raised dispute at TL level (no QA review needed)
    if (action === 'tl_resolve_dispute') {
      const { messageId, notes } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }
      const session = await getServerSession(authOptions).catch(() => null);
      const role = (session?.user as { role?: string } | undefined)?.role ?? '';
      if (!['admin', 'tl'].includes(role)) {
        return NextResponse.json({ error: 'Only a team lead can resolve a dispute at TL level' }, { status: 403 });
      }
      const email = ((session?.user as any)?.email || session?.user?.name || '') as string;
      const submitterName = await getSubmitterName(email);

      const evalRows = await query<any>(
        `SELECT id, ticket_id, message_id, flag_id, dispute_notes, agent_name FROM email_reply_evaluations WHERE message_id = $1`,
        [messageId]
      );
      if (!evalRows.length) {
        return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
      }
      const existing = evalRows[0];

      if (role === 'tl') {
        const tlAgents = await getScopedAgentNamesForUser(email, submitterName, 'tl', false);
        if (tlAgents && tlAgents.length > 0) {
          const lowerTL = tlAgents.map(a => a.trim().toLowerCase());
          if (!lowerTL.includes((existing.agent_name || '').trim().toLowerCase())) {
            return NextResponse.json({ error: 'Forbidden: You can only resolve disputes for your assigned agents' }, { status: 403 });
          }
        }
      }

      const flagId = existing.flag_id;

      if (flagId) {
        await storeUpdateIQSFlag(flagId, {
          status: 'tl_resolved',
          reviewedBy: email,
          reviewedAt: new Date().toISOString(),
          reviewNote: notes || 'Resolved query at TL level',
          updatedAt: new Date().toISOString(),
        });

        await storeAppendFlagComment({
          id: randomUUID(),
          flagId,
          authorEmail: email,
          authorName: submitterName,
          role: 'tl',
          content: `Resolved by TL: ${notes || 'Resolved query at TL level'}`,
          createdAt: new Date().toISOString(),
        });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = 'TL_Resolved',
             dispute_notes = COALESCE(dispute_notes, '') || ' [TL Resolved: ' || $1 || ']',
             updated_at = NOW()
         WHERE message_id = $2`,
        [notes || 'Resolved query at TL level', messageId]
      );

      await storeAppendAuditEntry({
        id: randomUUID(),
        action: 'dispute_resolved',
        chatId: existing.ticket_id || messageId,
        actorEmail: email,
        actorRole: role,
        ts: new Date().toISOString(),
        meta: { flagId, messageId, notes, resolvedBy: 'tl' },
      } as any);

      return NextResponse.json({ ok: true, message: 'Dispute resolved at TL level' });
    }

    // Action 4: Immediate sync re-evaluation of single reply
    if (action === 'evaluate_single') {
      const { messageId } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }
      const evalResult = await evaluateSingleReplySync(messageId);
      return NextResponse.json({ ok: true, evalResult });
    }

    // Action 5: Trigger batch jobs on demand
    if (action === 'trigger_batch') {
      const submitRes = await submitPendingEmailBatchJob();
      const collectRes = await collectAndProcessEmailBatchResults();
      return NextResponse.json({ ok: true, submit: submitRes, collect: collectRes });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('[api/email-evaluations POST] Error:', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
