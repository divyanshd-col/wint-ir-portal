import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeUpdateIQSFlag, storeAppendAuditEntry, storeGetIQSFlags, storeAppendFlagComment } from '@/lib/store';
import type { IQSAuditEntry } from '@/lib/store';
import { resolveQANameForChat } from '@/lib/qa-resolver';
import { readConfig } from '@/lib/config';
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

  let body: { flagId: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { flagId } = body;
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  const updated = await storeUpdateIQSFlag(flagId, { status: 'tl_forwarded' });
  if (!updated) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });

  // Lookup flag to resolve chatId & target QA
  const rawFlags = await storeGetIQSFlags();
  const flag = rawFlags
    .map(r => { try { return JSON.parse(r); } catch { return null; } })
    .find((f: any) => f && f.id === flagId);

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

