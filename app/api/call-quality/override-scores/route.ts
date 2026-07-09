const ROUTE = 'call-quality/override-scores';
import { log, withLogging } from '@/lib/log';
/**
 * PATCH /api/call-quality/override-scores
 *
 * Manually override call IQS scores for a chat (writes to iqs_scores.call_parameters
 * and recalculates call_iqs_score).
 *
 * Body: { chat_id: string, scores: Record<string, 'Yes'|'No'|'NA'>, reasoning: Record<string, string>, note?: string }
 * Auth: admin / quality / tl
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { calculateCallIQS, CALL_WEIGHTS } from '@/lib/call-quality';
import type { CallParamScore } from '@/lib/call-quality';

const CALL_PARAM_KEYS = Object.keys(CALL_WEIGHTS);

async function _PATCH(req: NextRequest): Promise<NextResponse> {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { chat_id: chatId, scores, reasoning, note } = body;
  if (!chatId) return NextResponse.json({ error: 'chat_id required' }, { status: 400 });
  if (!scores || typeof scores !== 'object') {
    return NextResponse.json({ error: 'scores object required' }, { status: 400 });
  }

  // Validate score values
  const validValues: CallParamScore[] = ['Yes', 'No', 'NA'];
  for (const [k, v] of Object.entries(scores)) {
    if (CALL_PARAM_KEYS.includes(k) && !validValues.includes(v as CallParamScore)) {
      return NextResponse.json({ error: `Invalid score value for ${k}: ${v}` }, { status: 400 });
    }
  }

  // Recalculate call IQS from overridden scores
  const callIqsScore = calculateCallIQS(scores as Record<string, CallParamScore>);

  // Build call_parameters JSON — merge scores + reasoning per parameter
  const callParameters: Record<string, { score: string; reasoning: string }> = {};
  for (const key of CALL_PARAM_KEYS) {
    callParameters[key] = {
      score:     scores[key] ?? 'NA',
      reasoning: (reasoning?.[key] || ''),
    };
  }

  const updatedBy = (session.user as any)?.email || 'unknown';
  const overrideNote = note ? `[Override by ${updatedBy}] ${note}` : `[Override by ${updatedBy}]`;

  // Upsert into iqs_scores — create row if it doesn't exist yet
  await query(`
    INSERT INTO iqs_scores (chat_id, call_iqs_score, call_parameters, call_model_version, call_scored_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      call_iqs_score     = EXCLUDED.call_iqs_score,
      call_parameters    = EXCLUDED.call_parameters,
      call_model_version = EXCLUDED.call_model_version,
      call_scored_at     = NOW()
  `, [chatId, callIqsScore, JSON.stringify(callParameters), `manual-override/${updatedBy}`]);

  // Optionally store the note in iqs_scores if the column exists (best-effort)
  try {
    await query(
      `UPDATE iqs_scores SET override_note = $1 WHERE chat_id = $2`,
      [overrideNote, chatId],
    );
  } catch {}

  return NextResponse.json({ ok: true, chatId, callIqsScore });
}

export const PATCH = withLogging(ROUTE, _PATCH);
