/**
 * POST /api/admin/score-pending
 *
 * Scores unscored conversations on demand — same logic as the daily
 * process-pending-scores cron, but triggerable by any logged-in user
 * and with a higher default limit (200 vs 50).
 *
 * Use this to drain the backlog of chats that were backfilled with
 * disposition tags but never got an IQS score.
 *
 * Query params:
 *   limit    — how many chats to score in one call (default 200, max 500)
 *   minHours — minimum age of chat in hours (default 0 = no restriction)
 *
 * Auth: any logged-in session
 *
 * Call repeatedly until response shows total: 0 to fully drain the queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getUnscoredConversations, getAgentName } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { executeScoring, scoreLinkedCallsForChat, transcriptFromJsonb } from '@/app/api/webhooks/chat/route';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const limit    = Math.min(parseInt(url.searchParams.get('limit')    ?? '200', 10), 500);
  const minHours = parseInt(url.searchParams.get('minHours') ?? '0',   10);

  const config = await readConfig();
  const convs  = await getUnscoredConversations(minHours, limit);

  const results: { chatId: string; iqs?: number; reason?: string }[] = [];

  for (const conv of convs) {
    const tags           = conv.tags as any;
    const disposition    = tags?.disposition    || '';
    const subDisposition = tags?.sub_disposition || '';

    try {
      const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';

      // Score the chat transcript
      const scored = await executeScoring(conv, agentName, disposition, subDisposition);
      if (!scored) {
        results.push({ chatId: conv.id, reason: 'skipped — executeScoring returned null' });
        continue;
      }

      // Also score any linked calls
      const transcriptMessages = Array.isArray(conv.transcript) ? conv.transcript
        : Array.isArray((conv.transcript as any)?.messages) ? (conv.transcript as any).messages : [];
      const chatTranscriptText = transcriptFromJsonb(transcriptMessages);
      await scoreLinkedCallsForChat(conv.id, chatTranscriptText, disposition, subDisposition, config).catch(() => {});

      results.push({ chatId: conv.id, iqs: scored.iqs });
    } catch (err: any) {
      results.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  const processed = results.filter(r => r.iqs !== undefined).length;
  const errors    = results.filter(r => r.reason?.startsWith('error')).length;

  console.log(`[admin/score-pending] processed=${processed}/${convs.length} errors=${errors} limit=${limit} minHours=${minHours}`);

  return NextResponse.json({
    ok: true,
    total: convs.length,
    processed,
    errors,
    results,
  });
}
