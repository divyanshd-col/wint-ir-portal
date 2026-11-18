const ROUTE = 'call-quality/evaluate';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { runPcgCallPipeline } from '@/lib/scoring/pcg-pipeline';
import { formatPcgCallIqsScoresForPanel } from '@/lib/pcg/call-params';
import { query } from '@/lib/cx/db';

async function _POST(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  let body: { callId?: string; forceTranscript?: boolean; reevaluate?: boolean; isPcg?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { callId } = body;
  if (!callId?.trim()) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  const trimmedId = callId.trim();
  const forceTranscript = body.forceTranscript ?? body.reevaluate ?? false;
  const forceReevaluate = Boolean(body.reevaluate);

  try {
    // Check if this is a PCG call (explicit flag or exists in pcg_call_recordings and not call_recordings)
    let isPcgCall = Boolean(body.isPcg);
    if (!isPcgCall) {
      const cxCheck = await query<{ id: string }>(`SELECT id FROM call_recordings WHERE id = $1 LIMIT 1`, [trimmedId]);
      if (cxCheck.length === 0) {
        const pcgCheck = await query<{ call_id: string }>(
          `SELECT call_id FROM pcg_call_recordings WHERE call_id = $1 OR id::text = $1 LIMIT 1`,
          [trimmedId]
        );
        if (pcgCheck.length > 0) isPcgCall = true;
      }
    }

    if (isPcgCall) {
      const pcgResult = await runPcgCallPipeline(trimmedId, { forceTranscript: Boolean(body.forceTranscript) });
      const evalRows = await query<any>(
        `SELECT iqs_score, parameters, compliance_tripwire, compliance_reason, verdict
         FROM pcg_call_evaluations
         WHERE call_id = $1 OR call_id = (SELECT call_id FROM pcg_call_recordings WHERE call_id = $1 OR id::text = $1 LIMIT 1)
         LIMIT 1`,
        [trimmedId]
      );
      const ev = evalRows[0] || {};
      const tripwire = Boolean(ev.compliance_tripwire);
      const reason = ev.compliance_reason || '';
      const lower = String(reason).toLowerCase();
      const g1Fail = tripwire && (lower.includes('advice') || lower.includes('tax') || lower.includes('guarantee') || lower.includes('assured') || lower.includes('promise'));
      const g3Fail = tripwire && (lower.includes('identity') || lower.includes('verif') || lower.includes('otp'));
      const g2Fail = tripwire && !g1Fail && !g3Fail;
      const gates = {
        status: tripwire ? 'FAIL' : 'PASS',
        call_gate_result: tripwire ? 'FAIL' : 'PASS',
        reason: reason || undefined,
        G1_no_advice: { status: g1Fail ? 'fail' : 'pass', reasoning: g1Fail ? reason : '' },
        G2_no_fabrication: { status: g2Fail ? 'fail' : 'pass', reasoning: g2Fail ? reason : '' },
        G3_identity_first: { status: g3Fail ? 'fail' : 'pass', reasoning: g3Fail ? reason : '' },
      };

      return NextResponse.json({
        ok: true,
        isPcg: true,
        callId: pcgResult?.callId || trimmedId,
        iqs: ev.iqs_score ?? pcgResult?.iqs ?? null,
        gates,
        iqsScores: formatPcgCallIqsScoresForPanel(ev.parameters || pcgResult?.parameters || []),
      });
    }

    const result = await runCallPipeline(trimmedId, { forceTranscript, forceReevaluate, skipSlackAlert: true });

    // Fetch updated evaluation record to return gates and iqsScores
    const evalRows = await query<any>(
      `SELECT gates, iqs_scores, iqs_percent, verdict, status FROM call_evaluations WHERE call_id = $1`,
      [trimmedId]
    );
    const evalData = evalRows[0] || {};

    return NextResponse.json({
      ok: true,
      ...result,
      gates: evalData.gates,
      iqsScores: evalData.iqs_scores
    });
  } catch (err: any) {
    log.error(ROUTE, `Failed to evaluate call ${callId}: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export const POST = withLogging(ROUTE, _POST);

