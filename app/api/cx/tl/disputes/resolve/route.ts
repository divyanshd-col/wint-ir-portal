import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeUpdateIQSFlag, storeAppendAuditEntry, storeGetIQSFlags, storeAppendFlagComment } from '@/lib/store';
import type { IQSFlag, IQSAuditEntry } from '@/lib/store';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { log } from '@/lib/log';
import { randomUUID } from 'crypto';
import { disputesOwnedByTL } from '@/lib/dispute-owner';

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

  const rawFlags = await storeGetIQSFlags();
  const flag: IQSFlag | undefined = rawFlags
    .map(r => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .find((f): f is IQSFlag => Boolean(f && f.id === flagId));

  // Once TLs own disputes they resolve through the evaluation panel (scores + audit-queue rule). This note-only close would mark the
  // chat reviewed and drop below-threshold items out of QA's audit, so it is closed for TLs.
  if (disputesOwnedByTL() && role === 'tl') {
    return NextResponse.json({ error: 'Resolve the dispute from the evaluation panel so the scores are updated' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const note = reviewNote?.trim() || 'Dispute reviewed and resolved by TL';

  // Automatically move status to 'reviewed'
  const updated = await storeUpdateIQSFlag(flagId, {
    status: 'reviewed',
    reviewedBy: email,
    reviewedAt: now,
    reviewNote: note,
    updatedAt: now,
  });

  if (!updated) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });

  // Resolve config name for TL
  const config = await readConfig().catch(() => null);
  const configUser = config?.users?.find((u: any) => (u.email || u.username)?.toLowerCase() === email.toLowerCase());
  const tlName = configUser?.agentName || configUser?.username || email.split('@')[0] || 'Team Leader';

  // Synchronize underlying call / chat / email evaluation records
  try {
    if (flag?.callId) {
      await query(
        `UPDATE call_evaluations
         SET status = 'reviewed', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE call_id = $3`,
        [tlName || email, note, flag.callId]
      ).catch(() => {});

      await query(
        `UPDATE pcg_call_evaluations
         SET dispute_status = 'resolved', reviewed_by = $1, reviewed_at = NOW(), tl_override_note = $2, updated_at = NOW()
         WHERE call_id = $3 OR call_id LIKE '%' || $3`,
        [tlName || email, note, flag.callId]
      ).catch(() => {});
    }

    if (flag?.chatId && !flag?.callId && !flag?.messageId) {
      await query(
        `UPDATE iqs_scores
         SET status = 'reviewed', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE chat_id = $3`,
        [tlName || email, note, flag.chatId]
      ).catch(() => {});
    }

    if (flag?.messageId) {
      await query(
        `UPDATE email_reply_evaluations
         SET dispute_status = 'Resolved', review_status = 'reviewed', reviewed_by = $1, reviewed_at = NOW(),
             qa_notes = COALESCE(qa_notes, '') || ' [TL Reviewed: ' || $2 || ']', updated_at = NOW()
         WHERE message_id = $3`,
        [tlName || email, note, flag.messageId]
      ).catch(() => {});
    }
  } catch (syncErr: any) {
    log.error('cx/tl/disputes/resolve', 'sync error', { flagId, err: syncErr?.message });
  }

  // Append thread comment
  await storeAppendFlagComment({
    id: randomUUID(),
    flagId,
    authorEmail: email,
    authorName: tlName,
    role: 'tl',
    content: `Reviewed by TL: ${note}`,
    createdAt: now,
  }).catch(() => {});

  await storeAppendAuditEntry({
    id: randomUUID(),
    action: 'tl_resolved_dispute',
    chatId: flag?.chatId || flag?.callId || flag?.messageId || '',
    actorEmail: email,
    actorRole: role,
    ts: now,
    meta: { flagId, reviewNote: note, status: 'reviewed' },
  } as IQSAuditEntry);

  log.info('cx/tl/disputes/resolve', 'reviewed and resolved', { flagId, actor: email });
  return NextResponse.json({ ok: true, status: 'reviewed' });
}
