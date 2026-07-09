const ROUTE = 'analytics/history';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getAllSessions } from '@/lib/analytics/sessions';

async function _GET() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const email = session!.user!.email ?? '';
  const sessions = await getAllSessions(email);
  return NextResponse.json({ sessions });
}

export const GET = withLogging(ROUTE, _GET);
