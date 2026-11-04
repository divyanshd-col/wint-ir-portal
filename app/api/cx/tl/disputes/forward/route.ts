import { query } from '@/lib/cx/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeUpdateIQSFlag, storeAppendAuditEntry, storeGetIQSFlags, storeAppendFlagComment } from '@/lib/store';
import type { IQSAuditEntry } from '@/lib/store';
import { resolveQANameForChat } from '@/lib/qa-resolver';
import { readConfig } from '@/lib/config';
import { log } from '@/lib/log';
import { getDefinedDispositions, findDefinedTopic } from '@/lib/qa-topics';
import { getConversation, updateConversationTags } from '@/lib/robylon/db';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || session.user?.name || 'unknown') as string;

  if (!['tl', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { flagId: string; disposition?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { flagId, disposition } = body;
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  const rawFlags = await storeGetIQSFlags();
  const flag = rawFlags
    .map(r => { try { return JSON.parse(r); } catch { return null; } })
    .find((f: any) => f && f.id === flagId);
  if (!flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });

  // A chat with no topic (or one no QA owns) cannot be routed to the responsible QA. The TL must pick a defined topic;
  // it is saved on the chat so the dispute reaches that topic's QA.
  if (flag.chatId && !flag.callId && !flag.messageId) {
    const defined = await getDefinedDispositions();
    const conv = await getConversation(String(flag.chatId));
    const current = String((conv?.tags as any)?.disposition ?? '').trim();
    // No topic list loaded (config unavailable): do not block the forward, a missing list must not make every chat unforwardable.
    if (defined.length > 0 && !findDefinedTopic(defined, current)) {
      const picked = findDefinedTopic(defined, disposition);
      if (!picked) {
        log.info('cx/tl/disputes/forward', 'topic_required', { flagId, chatId: flag.chatId, current, definedCount: defined.length });
        return NextResponse.json({ error: 'topic_required', definedDispositions: defined }, { status: 422 });
      }
      await updateConversationTags(String(flag.chatId), { disposition: picked, sub_disposition: String((conv?.tags as any)?.sub_disposition ?? '') });
    }
  }

  // Same rule for calls: the call's topic is call_recordings.call_disposition, the same topic list as chats.
  if (flag.callId) {
    const defined = await getDefinedDispositions();
    const rows = await query<{ d: string | null }>(`SELECT call_disposition AS d FROM call_recordings WHERE id = $1`, [flag.callId]);
    const current = String(rows[0]?.d ?? '').trim();
    if (defined.length > 0 && !findDefinedTopic(defined, current)) {
      const picked = findDefinedTopic(defined, disposition);
      if (!picked) {
        log.info('cx/tl/disputes/forward', 'topic_required', { flagId, callId: flag.callId, current, definedCount: defined.length });
        return NextResponse.json({ error: 'topic_required', definedDispositions: defined }, { status: 422 });
      }
      await query(`UPDATE call_recordings SET call_disposition = $1 WHERE id = $2`, [picked, flag.callId]);
    }
  }

  const updated = await storeUpdateIQSFlag(flagId, { status: 'tl_forwarded' });
  if (!updated) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });

  const chatId = flag?.chatId || '';
  const callId = flag?.callId;
  const qaName = await resolveQANameForChat(chatId, undefined, callId);

  const config = await readConfig();
  const configUser = config.users.find(u => (u.email || u.username)?.toLowerCase() === email.toLowerCase());
  const tlName = configUser?.agentName || email.split('@')[0];

  await storeAppendFlagComment({
    id: randomUUID(),
    flagId,
    authorEmail: email,
    authorName: tlName,
    role: 'tl',
    content: `Forwarded to ${qaName}`,
    createdAt: new Date().toISOString(),
  });

  await storeAppendAuditEntry({
    id: randomUUID(),
    action: 'tl_forwarded_dispute',
    chatId,
    actorEmail: email,
    actorRole: role,
    ts: new Date().toISOString(),
    meta: { flagId, targetQA: qaName },
  } as IQSAuditEntry);

  log.info('cx/tl/disputes/forward', 'forwarded', { flagId, actor: email, targetQA: qaName });
  return NextResponse.json({ ok: true });
}

