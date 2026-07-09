const ROUTE = 'kb-refresh';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { resetKBCache } from '@/lib/drive';

async function _POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = (session.user as any);
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await resetKBCache();
  return NextResponse.json({ ok: true });
}

export const POST = withLogging(ROUTE, _POST);
