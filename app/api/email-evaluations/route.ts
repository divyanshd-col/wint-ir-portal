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
import {
  evaluateSingleReplySync,
  submitPendingEmailBatchJob,
  collectAndProcessEmailBatchResults,
} from '@/lib/email/gemini-batch-evaluator';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentName = searchParams.get('agentName');
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
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
    const offset = Number(searchParams.get('offset') || 0);

    let whereClauses: string[] = ['1=1'];
    const params: any[] = [];

    if (agentName) {
      params.push(agentName);
      whereClauses.push(`e.agent_name ILIKE $${params.length}`);
    }

    // QA Review workflow filtering
    if (tab === 'pending' || reviewStatus === 'pending' || status === 'Pending_Review') {
      // Completed AI evaluation, pending QA review
      whereClauses.push(`e.evaluation_status = 'Completed' AND (e.review_status = 'pending' OR e.review_status IS NULL)`);
    } else if (tab === 'reviewed' || reviewStatus === 'reviewed' || status === 'Reviewed') {
      // Finalized & submitted by QA
      whereClauses.push(`e.review_status = 'reviewed'`);
    } else if (tab === 'unscored' || reviewStatus === 'unscored' || status === 'Unscored') {
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

    if (tab === 'disputes' || disputesOnly === 'true') {
      whereClauses.push(`e.dispute_status IN ('Raised', 'Under_Review')`);
    } else if (disputeStatus === 'pending') {
      whereClauses.push(`e.dispute_status IN ('Raised', 'Under_Review')`);
    } else if (disputeStatus === 'reviewed') {
      whereClauses.push(`e.dispute_status IN ('Resolved', 'Rejected')`);
    }

    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(
        `(e.ticket_id ILIKE $${params.length} OR e.agent_reply_text ILIKE $${params.length} OR e.customer_message ILIKE $${params.length} OR c.subject_line ILIKE $${params.length})`
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
        COALESCE(e.qa_override_score, e.quality_score) AS effective_score
      FROM email_reply_evaluations e
      JOIN email_conversations c ON e.ticket_id = c.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
        FROM robylon_webhook_payloads w,
             jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
        WHERE w.source = 'email' AND w.chat_id = c.chat_id
          AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
        ORDER BY w.received_at DESC LIMIT 1
      ) intent ON true
      WHERE ${whereSQL}
      ORDER BY e.sent_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const items = await query(itemsQuery, params);

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
    const rangeWhere = rangeClauses.length ? `WHERE ${rangeClauses.join(' AND ')}` : '';
    const rangeAnd = rangeClauses.length ? `AND ${rangeClauses.join(' AND ')}` : '';

    // 2. Fetch Aggregated Statistics & Tab Counts for Dashboard
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
        COUNT(CASE WHEN e.dispute_status IN ('Resolved', 'Rejected') THEN 1 END)::int AS reviewed_disputes_count,
        COUNT(CASE WHEN e.qa_override_score IS NOT NULL THEN 1 END)::int AS qa_overrides_count
      FROM email_reply_evaluations e
      ${rangeWhere}
    `;
    const statsRes = await query(statsQuery, rangeParams);
    const summary = statsRes?.[0] || {};

    // 3. Member-Level Breakdown for Team Lead View
    const tlBreakdownQuery = `
      SELECT 
        e.agent_name,
        COUNT(*)::int AS total_replies,
        ROUND(AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE e.evaluation_status = 'Completed'), 1) AS avg_score,
        COUNT(CASE WHEN e.compliance_passed = FALSE THEN 1 END)::int AS compliance_errors,
        COUNT(CASE WHEN e.dispute_status IN ('Raised', 'Under_Review') THEN 1 END)::int AS disputes_raised,
        COUNT(CASE WHEN e.qa_override_score IS NOT NULL THEN 1 END)::int AS overrides_count
      FROM email_reply_evaluations e
      WHERE e.agent_name IS NOT NULL ${rangeAnd}
      GROUP BY e.agent_name
      ORDER BY total_replies DESC
    `;
    const agentBreakdown = await query(tlBreakdownQuery, rangeParams);

    return NextResponse.json({
      ok: true,
      items: items || [],
      summary: {
        totalCount: Number(summary.total_count || 0),
        pendingCount: Number(summary.pending_review_count || 0),
        pendingReviewCount: Number(summary.pending_review_count || 0),
        reviewedCount: Number(summary.reviewed_count || 0),
        unscoredCount: Number(summary.unscored_count || 0),
        completedCount: Number(summary.completed_count || 0),
        avgScore: Number(summary.avg_score || 0),
        complianceBreachCount: Number(summary.compliance_breach_count || 0),
        activeDisputesCount: Number(summary.active_disputes_count || 0),
        reviewedDisputesCount: Number(summary.reviewed_disputes_count || 0),
        qaOverridesCount: Number(summary.qa_overrides_count || 0),
      },
      agentBreakdown: agentBreakdown || [],
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
      const reviewerEmail = (session?.user as any)?.email || session?.user?.name || body.reviewedBy || 'QA Reviewer';

      const finalScore = score !== undefined && score !== null
        ? Number(score)
        : (overrideScore !== undefined && overrideScore !== null ? Number(overrideScore) : null);

      await query(
        `UPDATE email_reply_evaluations
         SET qa_override_score = $1,
             qa_notes = COALESCE($2, qa_notes),
             parameter_scores = CASE WHEN $3::text IS NOT NULL THEN $3::jsonb ELSE parameter_scores END,
             review_status = 'reviewed',
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
          reviewerEmail,
          compliancePassed !== undefined ? Boolean(compliancePassed) : null,
          complianceIssues ? complianceIssues : null,
          messageId,
        ]
      );

      return NextResponse.json({ ok: true, message: 'Review submitted successfully' });
    }

    // Action 2: Agent raises a dispute (Page 7)
    if (action === 'raise_dispute') {
      const { messageId, notes } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = 'Raised',
             dispute_notes = $1,
             updated_at = NOW()
         WHERE message_id = $2`,
        [notes || 'Dispute raised by agent regarding score.', messageId]
      );

      return NextResponse.json({ ok: true, message: 'Dispute submitted successfully' });
    }

    // Action 3: QA resolves/rejects dispute (Page 7)
    if (action === 'resolve_dispute') {
      const { messageId, decision, notes, newScore } = body; // decision: 'Resolved' | 'Rejected'
      if (!messageId || !decision) {
        return NextResponse.json({ error: 'messageId and decision are required' }, { status: 400 });
      }

      const session = await getServerSession(authOptions).catch(() => null);
      const reviewerEmail = (session?.user as any)?.email || session?.user?.name || 'QA Reviewer';

      const updateScore = newScore !== undefined ? Number(newScore) : null;
      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = $1,
             qa_notes = COALESCE(qa_notes, '') || ' [Dispute Decision: ' || $1 || ' - ' || $2 || ']',
             qa_override_score = COALESCE($3, qa_override_score),
             review_status = 'reviewed',
             reviewed_by = COALESCE(reviewed_by, $4),
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE message_id = $5`,
        [decision, notes || '', updateScore, reviewerEmail, messageId]
      );

      return NextResponse.json({ ok: true, message: `Dispute marked as ${decision}` });
    }

    // Action 3b: TL forwards dispute to QA
    if (action === 'forward_dispute') {
      const { messageId, notes } = body;
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = 'Under_Review',
             dispute_notes = COALESCE(dispute_notes, '') || CASE WHEN $1::text IS NOT NULL THEN ' [TL Forward: ' || $1 || ']' ELSE '' END,
             updated_at = NOW()
         WHERE message_id = $2`,
        [notes || null, messageId]
      );

      return NextResponse.json({ ok: true, message: 'Dispute forwarded to QA successfully' });
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
