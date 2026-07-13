import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetConversations, storeSetConversations } from '@/lib/store';
import { readConfig } from '@/lib/config';
import type { SavedConversation } from '@/lib/types';

const MAX_CONVERSATIONS = 5;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await readConfig();
  if (!config.conversationHistoryEnabled) return NextResponse.json([]);

  const username = session.user?.name || 'unknown';
  const convs = await storeGetConversations(username);
  return NextResponse.json(convs);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await readConfig();
  if (!config.conversationHistoryEnabled) return NextResponse.json({ ok: true });

  const conversation: SavedConversation = await req.json();
  const username = session.user?.name || 'unknown';

  const existing = await storeGetConversations(username);
  // Prepend new, deduplicate by id, keep last MAX_CONVERSATIONS
  const updated = [conversation, ...existing.filter(c => c.id !== conversation.id)]
    .slice(0, MAX_CONVERSATIONS);

  await storeSetConversations(username, updated);
  return NextResponse.json({ ok: true });
}
