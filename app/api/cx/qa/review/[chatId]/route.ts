import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { calculateIQS } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';
import { storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
import type { IQSAuditEntry } from '@/lib/store';
import { log } from '@/lib/log';
import { randomUUID } from 'crypto';

const ROUTE = 'cx/qa/review';

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
  if (!['quality', 'admin', 'tl'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { chatId } = await params;
  const email = ((session.user as any).email || session.user?.name || 'unknown') as string;

  let body: {
    action:       'submit' | 'override' | 'resolve' | 'tl-submit' | 'tl-override';
    parameters?:  Record<string, { score: boolean | null; reasoning: string }>;
    note?:        string;
    flagId?:      string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, parameters, note, flagId } = body;
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  // QA actions restricted to quality/admin; TL actions restricted to tl/admin
  const qaOnlyAction = action === 'submit' || action === 'override' || action === 'resolve';
  const tlOnlyAction = action === 'tl-submit' || action === 'tl-override';
  if (qaOnlyAction && !['quality', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (tlOnlyAction && !['tl', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    if (action === 'tl-submit') {
      // TL accepts bot scoring — mark as TL-reviewed in parameters JSON
      const existing = await query<{ parameters: any }>(
        `SELECT parameters FROM iqs_scores WHERE chat_id = $1`, [chatId]
      );
      if (!existing.length) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      let existingParams = existing[0].parameters ?? {};
      if (typeof existingParams === 'string') { try { existingParams = JSON.parse(existingParams); } catch { existingParams = {}; } }
      const merged = { ...existingParams, __tl_reviewed_by: email, __tl_reviewed_at: new Date().toISOString() };
      await query(`UPDATE iqs_scores SET parameters = $1 WHERE chat_id = $2`, [JSON.stringify(merged), chatId]);
      log.info(ROUTE, 'tl-submit', { chatId, tl: email });
      await storeAppendAuditEntry({ id: randomUUID(), action: 'tl_submit', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { note: note ?? null } } as IQSAuditEntry);

    } else if (action === 'tl-override') {
      // TL corrects CAT 2 parameters
      if (!parameters) return NextResponse.json({ error: 'parameters required for tl-override' }, { status: 400 });
      const existing = await query<{ parameters: any; iqs_score: number }>(
        `SELECT parameters, iqs_score FROM iqs_scores WHERE chat_id = $1`, [chatId]
      );
      if (!existing.length) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      const oldIqs = existing[0].iqs_score;
      let existingParams = existing[0].parameters ?? {};
      if (typeof existingParams === 'string') { try { existingParams = JSON.parse(existingParams); } catch { existingParams = {}; } }
      const merged: Record<string, any> = { ...existingParams };
      let paramChanges = 0;
      for (const [key, val] of Object.entries(parameters)) {
        if (!key.startsWith('__')) {
          const prev = existingParams[key];
          if (!prev || prev.score !== val.score || prev.reasoning !== val.reasoning) paramChanges++;
          merged[key] = { score: val.score, reasoning: val.reasoning };
        }
      }
      merged['__tl_reviewed_by'] = email;
      merged['__tl_reviewed_at'] = new Date().toISOString();
      if (note) merged['__tl_override_note'] = note;
      const pascalScores: Record<string, ParamScore> = {};
      for (const [dbKey, val] of Object.entries(merged) as [string, any][]) {
        if (dbKey.startsWith('__')) continue;
        const pascal = DB_TO_PASCAL[dbKey];
        if (pascal) pascalScores[pascal] = val.score === true ? 'Yes' : val.score === false ? 'No' : 'NA';
      }
      const newIqs = calculateIQS(pascalScores);
      await query(
        `UPDATE iqs_scores SET parameters = $1, iqs_score = $2 WHERE chat_id = $3`,
        [JSON.stringify(merged), newIqs, chatId]
      );
      log.info(ROUTE, 'tl-override', { chatId, tl: email, oldIqs, newIqs, paramChanges });
      await storeAppendAuditEntry({ id: randomUUID(), action: 'tl_override', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { oldIqs, newIqs, paramChanges, note: note ?? null } } as IQSAuditEntry);

    } else if (action === 'submit') {
      await query(
        `UPDATE iqs_scores
         SET reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE chat_id = $3`,
        [email, note ?? null, chatId]
      );
      log.info(ROUTE, 'submit', { chatId, reviewer: email });
      await storeAppendAuditEntry({ id: randomUUID(), action: 'review_submitted', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { note: note ?? null } } as IQSAuditEntry);

    } else if (action === 'override' || action === 'resolve') {
      if (parameters) {
        // Fetch existing to merge
        const existing = await query<{ parameters: any; iqs_score: number }>(
          `SELECT parameters, iqs_score FROM iqs_scores WHERE chat_id = $1`,
          [chatId]
        );
        if (!existing.length) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });

        const oldIqs = existing[0].iqs_score;

        let existingParams = existing[0].parameters ?? {};
        if (typeof existingParams === 'string') {
          try { existingParams = JSON.parse(existingParams); } catch { existingParams = {}; }
        }

        // Merge incoming parameters (snake_case) into existing
        const merged: Record<string, any> = { ...existingParams };
        let paramChanges = 0;
        for (const [key, val] of Object.entries(parameters)) {
          if (!key.startsWith('__')) {
            const prev = existingParams[key];
            if (!prev || prev.score !== val.score || prev.reasoning !== val.reasoning) paramChanges++;
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

        log.info(ROUTE, action, { chatId, reviewer: email, oldIqs, newIqs, paramChanges });
        await storeAppendAuditEntry({ id: randomUUID(), action: 'score_overridden', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { oldIqs, newIqs, paramChanges, note: note ?? null } } as IQSAuditEntry);
      } else {
        // resolve without parameter changes — just mark reviewed
        await query(
          `UPDATE iqs_scores
           SET reviewed_by = $1, reviewed_at = NOW(), review_note = $2
           WHERE chat_id = $3`,
          [email, note ?? null, chatId]
        );
        log.info(ROUTE, action, { chatId, reviewer: email, paramChanges: 0 });
        await storeAppendAuditEntry({ id: randomUUID(), action: 'review_submitted', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { note: note ?? null } } as IQSAuditEntry);
      }

      // For resolve: mark the KV flag as reviewed
      if (action === 'resolve' && flagId) {
        await storeUpdateIQSFlag(flagId, {
          status:     'reviewed',
          reviewedBy: email,
          reviewedAt: new Date().toISOString(),
          reviewNote: note,
        });
        log.info(ROUTE, 'flag resolved', { chatId, flagId, reviewer: email });
        await storeAppendAuditEntry({ id: randomUUID(), action: 'dispute_resolved', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { flagId, note: note ?? null } } as IQSAuditEntry);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    log.error(ROUTE, 'error', { chatId, action, err: e.message ?? String(e) });
    return NextResponse.json({ error: e.message ?? 'Internal error' }, { status: 500 });
  }
}
