const ROUTE = 'quality/audit-log';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetAuditLog } from '@/lib/store';

async function _GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role as string;
  if (!['admin', 'quality'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '200')));
  const entries = await storeGetAuditLog(limit);
  return NextResponse.json({ entries });
}

export const GET = withLogging(ROUTE, _GET);
