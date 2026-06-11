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
 *
 * Differences from the daily cron:
 *  - Clears the 30-min scoring lock before each attempt so previously
 *    failed/locked chats are retried immediately.
 *  - Permanently-unscoreable chats (call interaction, unreadable transcript)
 *    are written to iqs_scores as a sentinel row so they never re-appear.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getUnscoredConversations, getAgentName, markChatUnscoreable } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { storeDeleteScoringLock } from '@/lib/store';
import { executeScoring, scoreLinkedCallsForChat, transcriptFromJsonb } from '@/app/api/webhooks/chat/route';
import { hasCallInteraction } from '@/lib/quality-alert';

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
      // ── Pre-flight: detect permanently-unscoreable chats ──────────────────
      // These chats will ALWAYS return null from executeScoring. Mark them in
      // iqs_scores now so getUnscoredConversations never picks them up again.

      const transcriptMessages = Array.isArray(conv.transcript) ? conv.transcript
        : Array.isArray((conv.transcript as any)?.messages) ? (conv.transcript as any).messages : [];
      const chatTranscriptText = transcriptFromJsonb(transcriptMessages);

      if (!chatTranscriptText) {
        await markChatUnscoreable(conv.id, 'empty-transcript');
        results.push({ chatId: conv.id, reason: 'marked-unscoreable: empty transcript' });
        continue;
      }

      if (hasCallInteraction(chatTranscriptText, conv.tags)) {
        await markChatUnscoreable(conv.id, 'call-interaction');
        results.push({ chatId: conv.id, reason: 'marked-unscoreable: call interaction detected' });
        continue;
      }

      // ── Release any stale scoring lock before attempting ──────────────────
      // The 30-min lock prevents the same chat from being scored twice by
      // concurrent webhook events. For admin batch scoring there is no
      // concurrency risk, so we clear it so a previously-failed attempt
      // doesn't block this run.
      await storeDeleteScoringLock(conv.id);

      // ── Score the chat transcript ─────────────────────────────────────────
      const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';
      const scored = await executeScoring(conv, agentName, disposition, subDisposition);
      if (!scored) {
        results.push({ chatId: conv.id, reason: 'skipped — executeScoring returned null' });
        continue;
      }

      // Also score any linked calls
      await scoreLinkedCallsForChat(conv.id, chatTranscriptText, disposition, subDisposition, config).catch(() => {});

      results.push({ chatId: conv.id, iqs: scored.iqs });
    } catch (err: any) {
      results.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  const processed  = results.filter(r => r.iqs !== undefined).length;
  const marked     = results.filter(r => r.reason?.startsWith('marked-unscoreable')).length;
  const errors     = results.filter(r => r.reason?.startsWith('error')).length;

  console.log(`[admin/score-pending] processed=${processed} marked=${marked} errors=${errors} total=${convs.length} limit=${limit} minHours=${minHours}`);

  return NextResponse.json({
    ok: true,
    total: convs.length,
    processed,
    marked,
    errors,
    results,
  });
}
