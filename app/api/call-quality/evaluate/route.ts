const ROUTE = 'call-quality/evaluate';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';

async function _POST(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  let body: { callId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { callId } = body;
  if (!callId?.trim()) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 });
  }

  try {
    const result = await runCallPipeline(callId.trim());
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    log.error(ROUTE, `Failed to evaluate call ${callId}: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export const POST = withLogging(ROUTE, _POST);
