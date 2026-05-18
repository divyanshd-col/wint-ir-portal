/**
 * GET /api/cron/process-pending-scores
 *
 * Runs daily (vercel.json). Safety net for chats that have transcript + tags
 * but were never scored (e.g. classification arrived before transcript edge case,
 * or scoring failed transiently). Picks up conversations closed > 12h ago with
 * no iqs_scores row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUnscoredConversations, getAgentName, getConversationsWithUnscoredLinkedCalls } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { executeScoring, scoreLinkedCallsForChat } from '@/app/api/webhooks/chat/route';
import { transcriptFromJsonb } from '@/app/api/webhooks/chat/route';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const config = await readConfig();

  // ── Pass 1: chats with transcript + tags but no iqs_scores row ───────────────
  const convs = await getUnscoredConversations();
  const chatResults: { chatId: string; iqs?: number; reason?: string }[] = [];

  for (const conv of convs) {
    const tags = conv.tags as any;
    const disposition    = tags?.disposition    || '';
    const subDisposition = tags?.sub_disposition || '';

    try {
      const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';
      const scored = await executeScoring(conv, agentName, disposition, subDisposition);
      if (!scored) {
        chatResults.push({ chatId: conv.id, reason: 'skipped — no entry returned' });
        continue;
      }
      console.log(`[cron] Scored chat ${conv.id} → IQS ${scored.iqs}%`);
      chatResults.push({ chatId: conv.id, iqs: scored.iqs });
    } catch (err: any) {
      console.error(`[cron] Error scoring chat ${conv.id}:`, err.message);
      chatResults.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  // ── Pass 2: chats that have status='linked' calls not yet scored ──────────────
  // This catches calls that arrived after the original chat scoring completed,
  // or calls whose first scoring attempt failed and were reset to 'linked'.
  const callConvs = await getConversationsWithUnscoredLinkedCalls();
  const callResults: { chatId: string; callsScored?: boolean; reason?: string }[] = [];

  for (const conv of callConvs) {
    const tags = conv.tags as any;
    const disposition    = tags?.disposition    || '';
    const subDisposition = tags?.sub_disposition || '';

    const transcriptMessages = Array.isArray(conv.transcript) ? conv.transcript
      : Array.isArray((conv.transcript as any)?.messages) ? (conv.transcript as any).messages : [];
    const chatTranscriptText = transcriptFromJsonb(transcriptMessages);

    try {
      await scoreLinkedCallsForChat(conv.id, chatTranscriptText, disposition, subDisposition, config);
      console.log(`[cron] Scored linked calls for chat ${conv.id}`);
      callResults.push({ chatId: conv.id, callsScored: true });
    } catch (err: any) {
      console.error(`[cron] Error scoring calls for chat ${conv.id}:`, err.message);
      callResults.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  const chatProcessed = chatResults.filter(r => r.iqs !== undefined).length;
  const callProcessed = callResults.filter(r => r.callsScored).length;
  console.log(`[cron] process-pending-scores: chats=${chatProcessed}/${convs.length}, call-scoring-runs=${callProcessed}/${callConvs.length}`);

  return NextResponse.json({
    ok: true,
    chats: { processed: chatProcessed, total: convs.length, results: chatResults },
    calls: { processed: callProcessed, total: callConvs.length, results: callResults },
  });
}
