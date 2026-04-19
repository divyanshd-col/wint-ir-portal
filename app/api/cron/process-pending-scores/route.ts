/**
 * GET /api/cron/process-pending-scores
 *
 * Runs daily (vercel.json). Safety net for chats that have transcript + tags
 * but were never scored (e.g. classification arrived before transcript edge case,
 * or scoring failed transiently). Picks up conversations closed > 12h ago with
 * no iqs_scores row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUnscoredConversations, getAgentName } from '@/lib/robylon/db';
import { executeScoring } from '@/app/api/webhooks/chat/route';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const convs = await getUnscoredConversations();
  if (!convs.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending scores' });
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
      console.log(`[cron] Scored chat ${conv.id} → IQS ${scored.iqs}%`);
      results.push({ chatId: conv.id, iqs: scored.iqs });
    } catch (err: any) {
      console.error(`[cron] Error scoring chat ${conv.id}:`, err.message);
      results.push({ chatId: conv.id, reason: `error: ${err.message}` });
    }
  }

  const processed = results.filter(r => r.iqs !== undefined).length;
  console.log(`[cron] process-pending-scores: ${processed}/${convs.length} scored`);
  return NextResponse.json({ ok: true, processed, total: convs.length, results });
}
