import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getUnscoredConversations, getAgentName } from '@/lib/robylon/db';
import { executeScoring } from '@/app/api/webhooks/chat/route';

// Scores ONE chat per call — caller loops until remaining === 0.
// This avoids Vercel's 300s timeout when many chats are pending.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const convs = await getUnscoredConversations();
  if (!convs.length) {
    return NextResponse.json({ ok: true, done: true, remaining: 0, chatId: null });
  }

  const conv = convs[0];
  const remaining = convs.length - 1;
  const tags = conv.tags as any;
  const disposition    = tags?.disposition    || '';
  const subDisposition = tags?.sub_disposition || '';

  try {
    const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';
    const scored = await executeScoring(conv, agentName, disposition, subDisposition);
    return NextResponse.json({
      ok: true,
      done: remaining === 0,
      remaining,
      chatId: conv.id,
      iqs: scored?.iqs ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      done: remaining === 0,
      remaining,
      chatId: conv.id,
      error: err.message,
    });
  }
}
