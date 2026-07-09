const ROUTE = 'quality/flag-thread';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { storeGetFlagThread, storeAppendFlagComment } from '@/lib/store';
import type { IQSFlagComment } from '@/lib/store';
import { randomUUID } from 'crypto';

// GET — load thread for a flag
async function _GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const flagId = new URL(req.url).searchParams.get('flagId');
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  const comments = await storeGetFlagThread(flagId);
  return NextResponse.json({ comments });
}

// POST — add a comment to a flag thread
async function _POST(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const { flagId, content } = await req.json();
  if (!flagId || !content?.trim()) return NextResponse.json({ error: 'flagId and content required' }, { status: 400 });

  const email = (session.user as any)?.email || '';
  const role = (session.user as any)?.role || 'agent';
  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();
  const configUser = config.users.find(u => (u.email || u.username) === email);
  const authorName = configUser?.agentName || email.split('@')[0];

  const comment: IQSFlagComment = {
    id: randomUUID(),
    flagId,
    authorEmail: email,
    authorName,
    role,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };

  await storeAppendFlagComment(comment);
  return NextResponse.json({ ok: true, comment });
}

export const GET = withLogging(ROUTE, _GET);
export const POST = withLogging(ROUTE, _POST);
