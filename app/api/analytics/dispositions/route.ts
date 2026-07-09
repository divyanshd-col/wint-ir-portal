const ROUTE = 'analytics/dispositions';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getDispositions } from '@/lib/analytics/dispositions';

async function _GET() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = await getDispositions();
    return NextResponse.json(payload);
  } catch (err: any) {
    log.error(ROUTE, '[analytics/dispositions] fetch failed:', err?.message);
    return NextResponse.json({ error: 'Failed to load dispositions' }, { status: 500 });
  }
}

export const GET = withLogging(ROUTE, _GET);
