import { NextResponse } from 'next/server';

// Superseded by /api/call-analysis/init + /api/call-analysis/run
export async function POST() {
  return NextResponse.json(
    { error: 'Use /api/call-analysis/init and /api/call-analysis/run instead' },
    { status: 410 },
  );
}
