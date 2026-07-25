import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
import type { IQSAuditEntry } from '@/lib/store';
import { log } from '@/lib/log';
import { randomUUID } from 'crypto';

// TL is view-only — disputes now go straight to QA, so this action is admin-only
// (kept for break-glass use; the TL UI no longer offers it).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || session.user?.name || 'unknown') as string;

  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { flagId: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { flagId } = body;
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  const updated = await storeUpdateIQSFlag(flagId, { status: 'tl_forwarded' });
  if (!updated) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });

  await storeAppendAuditEntry({
    id: randomUUID(),
    action: 'tl_forwarded_dispute',
    chatId: '',
    actorEmail: email,
    actorRole: role,
    ts: new Date().toISOString(),
    meta: { flagId },
  } as IQSAuditEntry);

  log.info('cx/tl/disputes/forward', 'forwarded', { flagId, actor: email });
  return NextResponse.json({ ok: true });
}
