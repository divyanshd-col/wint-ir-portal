/**
 * GET /api/cron/process-pending-scores
 *
 * Runs daily (vercel.json). Safety net for chats that have transcript + tags
 * but were never scored (e.g. classification arrived before transcript edge case).
 * CSAT is no longer a gate — it is updated passively via CSAT_SUBMITTED events.
 */

import { NextRequest, NextResponse } from 'next/server';
import { storeGetAllPendingScoreIds, storeGetPendingScore } from '@/lib/store';
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

  const ids = await storeGetAllPendingScoreIds();
  if (!ids.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending scores' });
  }

  const results: { chatId: string; iqs?: number; reason?: string }[] = [];

  for (const chatId of ids) {
    const state = await storeGetPendingScore(chatId);
    if (!state) continue;

    // Both transcript and tags are required — CSAT is not
    if (!state.hasTranscript || !state.hasTags) {
      results.push({ chatId, reason: `skipped — missing ${!state.hasTranscript ? 'transcript' : 'tags'}` });
      continue;
    }

    try {
      const scored = await executeScoring(state);
      if (!scored) {
        // null = bot-only chat, skipped intentionally (no LLM call made)
        results.push({ chatId, reason: 'skipped — bot-handled chat' });
        continue;
      }
      console.log(`[cron] Scored chat ${chatId} → IQS ${scored.iqs}%`);
      results.push({ chatId, iqs: scored.iqs });
    } catch (err: any) {
      console.error(`[cron] Error scoring chat ${chatId}:`, err.message);
      results.push({ chatId, reason: `error: ${err.message}` });
    }
  }

  const processed = results.filter(r => r.iqs !== undefined).length;
  console.log(`[cron] process-pending-scores: ${processed}/${ids.length} scored`);
  return NextResponse.json({ ok: true, processed, total: ids.length, results });
}
