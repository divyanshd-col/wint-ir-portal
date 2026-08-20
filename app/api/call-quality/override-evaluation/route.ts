const ROUTE = 'call-quality/override-evaluation';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { computeCallIQS, finalVerdict } from '@/lib/scoring/call-pipeline';

async function _PATCH(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const email = (session.user as any)?.email || '';

  let body: {
    callId?: string;
    scores?: Record<string, string>;
    reasoning?: Record<string, string>;
    note?: string;
    flagId?: string;
    action?: string;
  };

  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { callId, scores, reasoning, note, flagId } = body;
  if (!callId?.trim() || !scores) {
    return NextResponse.json({ error: 'callId and scores are required' }, { status: 400 });
  }

  // Fetch the existing call evaluation
  const evalRows = await query(`
    SELECT * FROM call_evaluations WHERE call_id = $1
  `, [callId.trim()]);

  if (!evalRows.length) {
    return NextResponse.json({ error: 'Call evaluation not found' }, { status: 404 });
  }

  const existingEval = evalRows[0];

  // Calculate new IQS percent & verdict
  const { iqs_percent, applicable_weight } = computeCallIQS(scores);
  const gateVerdict = existingEval.call_gate_result || 'PASS';
  const newVerdict = finalVerdict(gateVerdict, iqs_percent);

  // Extract old scores for auditing
  const oldIqsScores = existingEval.iqs_scores || {};
  const oldIqsPercent = existingEval.iqs_percent;

  try {
    // 1. Log to call_review_comparisons for audit trail
    await query(`
      INSERT INTO call_review_comparisons (
        call_id, ai_score, human_score, ai_parameters, human_parameters, action, reviewed_by, reviewed_at, review_note
      ) VALUES ($1, $2, $3, $4, $5, 'override', $6, NOW(), $7)
      ON CONFLICT (call_id) DO UPDATE SET
        human_score = EXCLUDED.human_score,
        human_parameters = EXCLUDED.human_parameters,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = NOW(),
        review_note = EXCLUDED.review_note
    `, [
      callId.trim(),
      oldIqsPercent,
      iqs_percent,
      JSON.stringify(oldIqsScores.scores || {}),
      JSON.stringify(scores),
      email,
      note || ''
    ]);

    // 2. Update call_evaluations
    // Construct new iqs_scores payload structure
    const newIqsScoresPayload = {
      scores,
      evidence: reasoning ? Object.entries(reasoning).reduce((acc, [k, v]) => ({ ...acc, [k]: [{ note: v }] }), {}) : {},
      summary: existingEval.iqs_scores?.summary || ''
    };

    await query(`
      UPDATE call_evaluations
      SET iqs_scores = $1,
          iqs_percent = $2,
          applicable_weight = $3,
          verdict = $4,
          reviewed_by = $5,
          reviewed_at = NOW(),
          review_note = $6,
          status = 'reviewed'
        WHERE call_id = $7
    `, [
      JSON.stringify(newIqsScoresPayload),
      iqs_percent,
      applicable_weight,
      newVerdict,
      email,
      note || '',
      callId.trim()
    ]);

    // 3. Update IQSFlag if associated with a dispute
    if (flagId) {
      const { storeUpdateIQSFlag, storeAppendAuditEntry } = await import('@/lib/store');
      const { randomUUID } = await import('crypto');
      await storeUpdateIQSFlag(flagId, {
        status: 'reviewed',
        reviewedBy: email,
        reviewedAt: new Date().toISOString(),
        reviewNote: note || '',
      });
      await storeAppendAuditEntry({
        id: randomUUID(),
        action: 'review_submitted',
        chatId: callId.trim(),
        actorEmail: email,
        actorRole: (session.user as any)?.role || 'quality',
        ts: new Date().toISOString(),
        meta: { oldIqs: oldIqsPercent, newIqs: iqs_percent, note: note || '', flagId },
      });
    }

    log.info(ROUTE, `Quality override complete for call ${callId} by ${email}`);
    return NextResponse.json({ ok: true, iqs: iqs_percent, verdict: newVerdict });
  } catch (err: any) {
    log.error(ROUTE, `Override database operations failed for call ${callId}: ${err.message}`);
    return NextResponse.json({ error: 'Database update failed', detail: err.message }, { status: 500 });
  }
}

export const PATCH = withLogging(ROUTE, _PATCH);
export const POST = withLogging(ROUTE, _PATCH);
