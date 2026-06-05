import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { calculateIQS } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';
import { storeUpdateIQSFlag } from '@/lib/store';

// DB snake_case → PascalCase for calculateIQS
const DB_TO_PASCAL: Record<string, string> = {
  technical:    'Technical',
  all_questions:'AllQuestions',
  expectation:  'Expectation',
  contextual:   'Contextual',
  follow_up:    'FollowUp',
  sentences:    'Sentences',
  process:      'Process',
  opening:      'Opening',
  call:         'Call',
  grammar:      'Grammar',
  empathy:      'Empathy',
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role as string;
  if (!['quality', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { chatId } = await params;
  const email   = ((session.user as any).email || session.user?.name || 'unknown') as string;

  let body: {
    action:       'submit' | 'override' | 'resolve';
    parameters?:  Record<string, { score: boolean | null; reasoning: string }>;
    note?:        string;
    flagId?:      string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, parameters, note, flagId } = body;
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  try {
    if (action === 'submit') {
      // Mark as reviewed without changing parameters
      await query(
        `UPDATE iqs_scores
         SET reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE chat_id = $3`,
        [email, note ?? null, chatId]
      );

    } else if (action === 'override' || action === 'resolve') {
      if (parameters) {
        // Fetch existing to merge
        const existing = await query<{ parameters: any; iqs_score: number }>(
          `SELECT parameters, iqs_score FROM iqs_scores WHERE chat_id = $1`,
          [chatId]
        );
        if (!existing.length) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });

        let existingParams = existing[0].parameters ?? {};
        if (typeof existingParams === 'string') {
          try { existingParams = JSON.parse(existingParams); } catch { existingParams = {}; }
        }

        // Merge incoming parameters (snake_case) into existing
        const merged: Record<string, any> = { ...existingParams };
        for (const [key, val] of Object.entries(parameters)) {
          if (!key.startsWith('__')) {
            merged[key] = { score: val.score, reasoning: val.reasoning };
          }
        }
        if (note) merged['__review_note'] = note;

        // Recalculate IQS — convert snake_case scores to PascalCase Yes/No/NA
        const pascalScores: Record<string, ParamScore> = {};
        for (const [dbKey, val] of Object.entries(merged) as [string, any][]) {
          if (dbKey.startsWith('__')) continue;
          const pascal = DB_TO_PASCAL[dbKey];
          if (pascal) {
            pascalScores[pascal] = val.score === true ? 'Yes' : val.score === false ? 'No' : 'NA';
          }
        }
        const newIqs = calculateIQS(pascalScores);

        await query(
          `UPDATE iqs_scores
           SET parameters = $1, iqs_score = $2,
               reviewed_by = $3, reviewed_at = NOW(), review_note = $4
           WHERE chat_id = $5`,
          [JSON.stringify(merged), newIqs, email, note ?? null, chatId]
        );
      } else {
        // resolve without parameter changes — just mark reviewed
        await query(
          `UPDATE iqs_scores
           SET reviewed_by = $1, reviewed_at = NOW(), review_note = $2
           WHERE chat_id = $3`,
          [email, note ?? null, chatId]
        );
      }

      // For resolve: mark the KV flag as reviewed
      if (action === 'resolve' && flagId) {
        await storeUpdateIQSFlag(flagId, {
          status:     'reviewed',
          reviewedBy: email,
          reviewedAt: new Date().toISOString(),
          reviewNote: note,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[qa/review]', e);
    return NextResponse.json({ error: e.message ?? 'Internal error' }, { status: 500 });
  }
}
