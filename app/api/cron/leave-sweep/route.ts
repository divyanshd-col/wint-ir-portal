import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { requestsReady, sweepDue } from '@/lib/leave-requests';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Decides requests whose 5 minutes are up, cancels auto-rejected ones past 11:59 pm IST, and marks past leave as Taken.
 * Fails closed: needs `Authorization: Bearer $CRON_SECRET`. Safe to call as often as you like (every minute is ideal, from
 * cron-job.org or a Vercel cron). The pages also run it when someone opens them, so nothing waits forever without it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requestsReady({ query }))) return NextResponse.json({ ok: true, skipped: 'leave tables not ready' });
  return NextResponse.json({ ok: true, ...(await sweepDue(withTransaction, { query })) });
}
