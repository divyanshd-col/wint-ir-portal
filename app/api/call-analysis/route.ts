const ROUTE = 'call-analysis';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';

// Superseded by /api/call-analysis/init + /api/call-analysis/run
async function _POST() {
  return NextResponse.json(
    { error: 'Use /api/call-analysis/init and /api/call-analysis/run instead' },
    { status: 410 },
  );
}

export const POST = withLogging(ROUTE, _POST);
