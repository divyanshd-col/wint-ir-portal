const ROUTE = 'call-quality/evaluate';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { query } from '@/lib/cx/db';

async function _POST(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality']);
  if (response) return response;

  let body: { callId?: string; forceTranscript?: boolean; reevaluate?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { callId } = body;
  if (!callId?.trim()) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  const forceTranscript = body.forceTranscript ?? body.reevaluate ?? false;

  try {
    const result = await runCallPipeline(callId.trim(), { forceTranscript });
    
    // Fetch updated evaluation record to return gates and iqsScores
    const evalRows = await query<any>(
      `SELECT gates, iqs_scores, iqs_percent, verdict, status FROM call_evaluations WHERE call_id = $1`,
      [callId.trim()]
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

