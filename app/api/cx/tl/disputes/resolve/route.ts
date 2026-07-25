import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetIQSFlags, storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
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

  let body: { flagId: string; note?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { flagId, note } = body;
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  // Verify the flag is a CAT2 IR-raised flag that is still pending TL action
  const rawFlags = await storeGetIQSFlags();
  const flag = rawFlags
    .map(r => { try { return JSON.parse(r); } catch { return null; } })
    .find(f => f?.id === flagId);

  if (!flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
  if (flag.paramCategory !== 'cat2') return NextResponse.json({ error: 'Only CAT2 flags can be resolved by TL' }, { status: 400 });
  if (flag.status !== 'ir_pending_tl') return NextResponse.json({ error: 'Flag is not in ir_pending_tl state' }, { status: 400 });

  const now = new Date().toISOString();
  const updated = await storeUpdateIQSFlag(flagId, {
    status: 'tl_resolved',
    updatedAt: now,
    reviewedBy: email,
    reviewedAt: now,
    reviewNote: note || '',
  });
  if (!updated) return NextResponse.json({ error: 'Failed to update flag' }, { status: 500 });

  await storeAppendAuditEntry({
    id: randomUUID(),
    action: 'tl_resolved_cat2',
    chatId: flag.chatId,
    actorEmail: email,
    actorRole: role,
    ts: now,
    meta: { flagId, note: note || '' },
  } as IQSAuditEntry);

  log.info('cx/tl/disputes/resolve', 'resolved', { flagId, actor: email });
  return NextResponse.json({ ok: true });
}
