import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getUnscoredConversations, getAgentName } from '@/lib/robylon/db';
import { executeScoring } from '@/app/api/webhooks/chat/route';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const convs = await getUnscoredConversations();
  if (!convs.length) {
    return NextResponse.json({ ok: true, processed: 0, total: 0, results: [] });
  }

  const results: { chatId: string; iqs?: number; reason?: string }[] = [];

  for (const conv of convs) {
    const tags = conv.tags as any;
    const disposition    = tags?.disposition    || '';
    const subDisposition = tags?.sub_disposition || '';

    try {
      const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';
      const scored = await executeScoring(conv, agentName, disposition, subDisposition);
      if (!scored) {
        results.push({ chatId: conv.id, reason: 'skipped — no entry returned' });
        continue;
      }
      results.push({ chatId: conv.id, iqs: scored.iqs });
    } catch (err: any) {
      results.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  const processed = results.filter(r => r.iqs !== undefined).length;
  return NextResponse.json({ ok: true, processed, total: convs.length, results });
}
