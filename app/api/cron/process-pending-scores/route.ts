/**
 * GET /api/cron/process-pending-scores
 *
 * Runs every hour (see vercel.json).
 * Finds pending chats that have transcript + tags but no CSAT for ≥ 12 hours
 * and scores them — so CSAT absence never permanently blocks quality analysis.
 */

import { NextRequest, NextResponse } from 'next/server';
import { storeGetAllPendingScoreIds, storeGetPendingScore } from '@/lib/store';
import { executeScoring } from '@/app/api/webhooks/chat/route';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Allow Vercel cron (no Authorization header) or explicit secret for manual triggers
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

  const now     = Date.now();
  const results: { chatId: string; iqs?: number; reason?: string }[] = [];

  for (const chatId of ids) {
    const state = await storeGetPendingScore(chatId);
    if (!state) continue;

    // Must have transcript + tags — CSAT is optional after 12 h
    if (!state.hasTranscript || !state.hasTags) {
      results.push({ chatId, reason: 'skipped — missing transcript or tags' });
      continue;
    }

    // Already has all three — the webhook should have scored it, but handle edge cases
    if (state.hasCsat) {
      try {
        const scored = await executeScoring(state);
        results.push({ chatId, iqs: scored.iqs });
      } catch (err: any) {
        console.error(`[cron] Error scoring chat ${chatId}:`, err.message);
        results.push({ chatId, reason: `error: ${err.message}` });
      }
      continue;
    }

    // No CSAT — only proceed after 12 hours
    const age = now - new Date(state.createdAt).getTime();
    if (age < TWELVE_HOURS_MS) {
      const hoursLeft = Math.ceil((TWELVE_HOURS_MS - age) / 3600000);
      results.push({ chatId, reason: `waiting ${hoursLeft}h more for CSAT` });
      continue;
    }

    // 12 h elapsed, no CSAT — score without it
    try {
      const scored = await executeScoring(state);
      console.log(`[cron] Scored chat ${chatId} (no CSAT after 12 h) → IQS ${scored.iqs}%`);
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
