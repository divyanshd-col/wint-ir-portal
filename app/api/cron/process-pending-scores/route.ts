/**
 * GET /api/cron/process-pending-scores
 *
 * Runs daily (vercel.json). Safety net for chats that have transcript + tags
 * but were never scored (e.g. classification arrived before transcript edge case,
 * or scoring failed transiently). Picks up conversations closed > 12h ago with
 * no iqs_scores row.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUnscoredConversations,
  getAgentName,
  getConversationsWithUnscoredLinkedCalls,
  getStrandedCallsLast7Days,
  findClosedConversationForCall,
  linkCallToChat,
  recordChatScoringFailure,
  recordLinkedCallsScoringFailure,
  recordCallPipelineFailure,
} from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { executeScoring, scoreLinkedCallsForChat } from '@/lib/scoring/engine';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { transcriptFromJsonb } from '@/lib/scoring/transcript';

export const maxDuration = 300; // 5 minutes max duration on Vercel Pro

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const deadline = Date.now() + 240_000; // stop cleanly before 300s timeout
  const config = await readConfig();

  // ── Pass 0: Recover stranded calls from the last 7 days ─────────────────────
  const strandedCalls = await getStrandedCallsLast7Days(20);
  const strandedResults: { callId: string; action: string; reason?: string }[] = [];

  for (const call of strandedCalls) {
    if (Date.now() > deadline) break;
    try {
      if (call.status === 'pending_link') {
        if (call.contact_id && call.called_at) {
          const conv = await findClosedConversationForCall(call.contact_id, call.called_at, call.agent_id);
          if (conv) {
            await linkCallToChat(call.id, conv.id);
            strandedResults.push({ callId: call.id, action: `linked:${conv.id}` });
            continue;
          }
        }
        strandedResults.push({ callId: call.id, action: 'still_pending_link' });
      } else {
        await runCallPipeline(call.id);
        strandedResults.push({ callId: call.id, action: 'pipeline_recovered' });
      }
    } catch (err: any) {
      console.error(`[cron] Error recovering stranded call ${call.id}:`, err.message);
      await recordCallPipelineFailure(call.id, err.message).catch(() => {});
      strandedResults.push({ callId: call.id, action: 'error', reason: err.message });
    }
  }

  // ── Pass 1: chats with transcript but no iqs_scores row (closed > 1h ago) ────
  const convs = Date.now() < deadline ? await getUnscoredConversations(1, 50) : [];
  const chatResults: { chatId: string; iqs?: number; reason?: string }[] = [];

  for (const conv of convs) {
    if (Date.now() > deadline) break;
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
      await recordChatScoringFailure(conv.id, err.message).catch(() => {});
      chatResults.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  // ── Pass 2: chats that have status='linked' calls (last 7 days) not yet scored ─
  const callConvs = Date.now() < deadline ? await getConversationsWithUnscoredLinkedCalls() : [];
  const callResults: { chatId: string; callsScored?: boolean; reason?: string }[] = [];

  for (const conv of callConvs) {
    if (Date.now() > deadline) break;
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
      await recordLinkedCallsScoringFailure(conv.id, err.message).catch(() => {});
      callResults.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  const chatProcessed = chatResults.filter(r => r.iqs !== undefined).length;
  const callProcessed = callResults.filter(r => r.callsScored).length;
  console.log(`[cron] process-pending-scores: stranded=${strandedResults.length}, chats=${chatProcessed}/${convs.length}, call-scoring-runs=${callProcessed}/${callConvs.length}`);

  return NextResponse.json({
    ok: true,
    stranded: { checked: strandedCalls.length, results: strandedResults },
    chats: { processed: chatProcessed, total: convs.length, results: chatResults },
    calls: { processed: callProcessed, total: callConvs.length, results: callResults },
  });
}
