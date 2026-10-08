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
    const maxScore = searchParams.get('maxScore'); // e.g. 85 for QA low scores
    const minScore = searchParams.get('minScore');
    const complianceFailed = searchParams.get('complianceFailed');
    const disputesOnly = searchParams.get('disputesOnly');
    const ticketId = searchParams.get('ticketId');
    const search = searchParams.get('search');
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
    const offset = Number(searchParams.get('offset') || 0);

    let whereClauses: string[] = ['1=1'];
    const params: any[] = [];

    if (agentName) {
      params.push(agentName);
      whereClauses.push(`e.agent_name ILIKE $${params.length}`);
    }

    if (status) {
      params.push(status);
      whereClauses.push(`e.evaluation_status = $${params.length}`);
    }

    if (ticketId) {
      params.push(ticketId);
      whereClauses.push(`e.ticket_id = $${params.length}`);
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

    if (disputesOnly === 'true') {
      whereClauses.push(`e.dispute_status IN ('Raised', 'Under_Review')`);
    }

    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(
        `(e.ticket_id ILIKE $${params.length} OR e.agent_reply_text ILIKE $${params.length} OR e.customer_message ILIKE $${params.length} OR c.subject_line ILIKE $${params.length})`
      );
    }

    const whereSQL = whereClauses.join(' AND ');

    // 1. Fetch evaluated items with conversation subject
    const itemsQuery = `
      SELECT 
        e.*,
        c.subject_line,
        c.customer_email,
        c.status AS conversation_status,
        c.merged_into_ticket_id,
        COALESCE(e.qa_override_score, e.quality_score) AS effective_score
      FROM email_reply_evaluations e
      JOIN email_conversations c ON e.ticket_id = c.id
      WHERE ${whereSQL}
      ORDER BY e.sent_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const items = await query(itemsQuery, params);

    // 2. Fetch Aggregated Statistics for Dashboard
    const statsQuery = `
      SELECT 
        COUNT(*)::int AS total_count,
        COUNT(CASE WHEN e.evaluation_status = 'Pending' THEN 1 END)::int AS pending_count,
        COUNT(CASE WHEN e.evaluation_status = 'In_Batch' THEN 1 END)::int AS in_batch_count,
        COUNT(CASE WHEN e.evaluation_status = 'Completed' THEN 1 END)::int AS completed_count,
        ROUND(AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE e.evaluation_status = 'Completed'), 2) AS avg_score,
        COUNT(CASE WHEN e.compliance_passed = FALSE THEN 1 END)::int AS compliance_breach_count,
        COUNT(CASE WHEN e.dispute_status = 'Raised' THEN 1 END)::int AS active_disputes_count,
        COUNT(CASE WHEN e.qa_override_score IS NOT NULL THEN 1 END)::int AS qa_overrides_count
      FROM email_reply_evaluations e
      WHERE ${whereSQL}
    `;
    const statsRes = await query(statsQuery, params);
    const summary = statsRes?.[0] || {};

    // 3. Member-Level Breakdown for Team Lead View
    const tlBreakdownQuery = `
      SELECT 
        e.agent_name,
        COUNT(*)::int AS total_replies,
        ROUND(AVG(COALESCE(e.qa_override_score, e.quality_score)) FILTER (WHERE e.evaluation_status = 'Completed'), 1) AS avg_score,
        COUNT(CASE WHEN e.compliance_passed = FALSE THEN 1 END)::int AS compliance_errors,
        COUNT(CASE WHEN e.dispute_status = 'Raised' THEN 1 END)::int AS disputes_raised,
        COUNT(CASE WHEN e.qa_override_score IS NOT NULL THEN 1 END)::int AS overrides_count
      FROM email_reply_evaluations e
      WHERE e.agent_name IS NOT NULL
      GROUP BY e.agent_name
      ORDER BY total_replies DESC
    `;
    const agentBreakdown = await query(tlBreakdownQuery);

    return NextResponse.json({
      ok: true,
      items: items || [],
      summary: {
        totalCount: Number(summary.total_count || 0),
        pendingCount: Number(summary.pending_count || 0),
        inBatchCount: Number(summary.in_batch_count || 0),
        completedCount: Number(summary.completed_count || 0),
        avgScore: Number(summary.avg_score || 0),
        complianceBreachCount: Number(summary.compliance_breach_count || 0),
        activeDisputesCount: Number(summary.active_disputes_count || 0),
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

    // Action 1: QA manual score override and notes (Page 6 & 7)
    if (action === 'qa_override') {
      const { messageId, overrideScore, qaNotes, parameterScores } = body;
      if (!messageId || overrideScore === undefined) {
        return NextResponse.json({ error: 'messageId and overrideScore are required' }, { status: 400 });
      }

      await query(
        `UPDATE email_reply_evaluations
         SET qa_override_score = $1,
             qa_notes = COALESCE($2, qa_notes),
             parameter_scores = CASE WHEN $3::text IS NOT NULL THEN $3::jsonb ELSE parameter_scores END,
             updated_at = NOW()
         WHERE message_id = $4`,
        [
          Number(overrideScore),
          qaNotes || null,
          parameterScores ? JSON.stringify(parameterScores) : null,
          messageId,
        ]
      );

      return NextResponse.json({ ok: true, message: 'QA override updated successfully' });
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

      const updateScore = newScore !== undefined ? Number(newScore) : null;
      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = $1,
             qa_notes = COALESCE(qa_notes, '') || ' [Dispute Decision: ' || $1 || ' - ' || $2 || ']',
             qa_override_score = COALESCE($3, qa_override_score),
             updated_at = NOW()
         WHERE message_id = $4`,
        [decision, notes || '', updateScore, messageId]
      );

      return NextResponse.json({ ok: true, message: `Dispute marked as ${decision}` });
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
