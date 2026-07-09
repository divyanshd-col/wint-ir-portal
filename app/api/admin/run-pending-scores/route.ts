const ROUTE = 'admin/run-pending-scores';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getUnscoredConversations, countUnscoredConversations, getAgentName } from '@/lib/robylon/db';
import { executeScoring } from '@/lib/scoring/engine';

// Scores ONE chat per call — caller loops until done === true.
// Uses minHoursOld=0 so manual backfill catches ALL unscored chats,
// not just those older than 12 h (which is only the cron's safety net).
async function _POST() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Count total remaining BEFORE fetching so the UI can show accurate progress
  const totalRemaining = await countUnscoredConversations(0);
  if (totalRemaining === 0) {
    return NextResponse.json({ ok: true, done: true, remaining: 0, chatId: null });
  }

  const convs = await getUnscoredConversations(0);
  if (!convs.length) {
    return NextResponse.json({ ok: true, done: true, remaining: 0, chatId: null });
  }

  // Try each chat in order — skip any whose scoring lock is currently held
  for (const conv of convs) {
    const tags = conv.tags as any;
    const disposition    = tags?.disposition    || '';
    const subDisposition = tags?.sub_disposition || '';

    try {
      const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';
      const scored = await executeScoring(conv, agentName, disposition, subDisposition);

      if (scored === null) {
        // Lock held for this chat — try the next one in the batch
        continue;
      }

      return NextResponse.json({
        ok: true,
        done: totalRemaining <= 1,
        remaining: Math.max(0, totalRemaining - 1),
        chatId: conv.id,
        iqs: scored.iqs,
      });
    } catch (err: any) {
      return NextResponse.json({
        ok: false,
        done: totalRemaining <= 1,
        remaining: Math.max(0, totalRemaining - 1),
        chatId: conv.id,
        error: err.message,
      });
    }
  }

  // Every chat in this batch is locked — signal done to stop the loop
  return NextResponse.json({ ok: true, done: true, remaining: 0, chatId: null });
}

export const POST = withLogging(ROUTE, _POST);
