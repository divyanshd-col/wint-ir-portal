import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
import type { IQSAuditEntry } from '@/lib/store';
import { log } from '@/lib/log';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || session.user?.name || 'unknown') as string;

  if (!['tl', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { flagId: string; reviewNote?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { flagId, reviewNote } = body;
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  const now = new Date().toISOString();
  const note = reviewNote?.trim() || 'Resolved query at TL level';

  const updated = await storeUpdateIQSFlag(flagId, {
    status: 'tl_resolved',
    reviewedBy: email,
    reviewedAt: now,
    reviewNote: note,
  });

  if (!updated) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });

  await storeAppendAuditEntry({
    id: randomUUID(),
    action: 'tl_resolved_dispute',
    chatId: '',
    actorEmail: email,
    actorRole: role,
    ts: now,
    meta: { flagId, reviewNote: note },
  } as IQSAuditEntry);

  log.info('cx/tl/disputes/resolve', 'resolved', { flagId, actor: email });
  return NextResponse.json({ ok: true });
}
