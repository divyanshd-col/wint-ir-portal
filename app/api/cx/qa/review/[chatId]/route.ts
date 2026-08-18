import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { calculateIQS, isV4Evaluation } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';
import { storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
import type { IQSAuditEntry } from '@/lib/store';
import { log } from '@/lib/log';
import { randomUUID } from 'crypto';
import { ALL_DB_KEY_TO_PASCAL as DB_TO_PASCAL } from '@/lib/param-keys';
import { fireKbChangeAlert } from '@/lib/quality-alert';

// Bot-distinctive DB keys — parameters that appear ONLY in the bot rubric, never
// the human one. IssueResolution/Accuracy/Personalization are shared between both
// rubrics in v4, so keying off them mis-flags every v4 human chat as a bot chat.
const BOT_ONLY_DB_KEYS = ['correct_escalation', 'no_repetition', 'expectation_setting', 'clarity'];

const ROUTE = 'cx/qa/review';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role as string;
  // QA reviews chats; TL is view-only and has no mutating access here.
  if (!['quality', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { chatId } = await params;
  const email = ((session.user as any).email || session.user?.name || 'unknown') as string;

  let body: {
    action:       'submit' | 'override' | 'resolve' | 'reopen';
    parameters?:  Record<string, { score: boolean | null; reasoning: string }>;
    note?:        string;
    flagId?:      string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, parameters, note, flagId } = body;
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });
  // A resolve without its flag would mark the chat reviewed but leave the dispute
  // stuck in 'pending' forever — reject it up front.
  if (action === 'resolve' && !flagId) {
    return NextResponse.json({ error: 'flagId required for resolve' }, { status: 400 });
  }

  try {
    const beforeState = await query<{ conversation_type: string; iqs_score: number; parameters: any }>(
      `SELECT c.conversation_type, i.iqs_score, i.parameters
       FROM iqs_scores i
       LEFT JOIN conversations c ON c.id = i.chat_id
       WHERE i.chat_id = $1`, [chatId]
    );
    const oldScore = beforeState[0]?.iqs_score ?? null;
    const oldParams = beforeState[0]?.parameters ?? null;
    const convType = beforeState[0]?.conversation_type;
    const isBot = convType === 'bot' || (convType !== 'agent' && convType !== 'hybrid' && (() => {
      if (!oldParams) return false;
      if (oldParams.__agent_parameters && !oldParams.__bot_parameters) return false;
      // A bot-only chat stores its params under __bot_parameters (no __agent_parameters).
      // Detect it by the presence of a bot-distinctive key, not a shared one.
      const safeParams = oldParams.__bot_parameters
        || (oldParams.__agent_parameters ? {} : oldParams);
      return Object.keys(safeParams).some(k => BOT_ONLY_DB_KEYS.includes(k));
    })());

    let finalMergedParams: Record<string, any> | null = null;

    if (action === 'submit' || action === 'override' || action === 'resolve') {
      let isScoreUpdated = false;
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

        const isV4 = isV4Evaluation(existingParams);

        // Merge incoming parameters (snake_case) into existing.
        const merged: Record<string, any> = { ...existingParams };
        if (existingParams.__agent_parameters) merged.__agent_parameters = { ...existingParams.__agent_parameters };
        if (existingParams.__bot_parameters) merged.__bot_parameters = { ...existingParams.__bot_parameters };
        let paramChanges = 0;

        if (parameters.__bot_parameters) {
          merged.__bot_parameters = { ...(merged.__bot_parameters || {}) };
          for (const [key, val] of Object.entries(parameters.__bot_parameters) as [string, any][]) {
            const prev = merged.__bot_parameters[key];
            if (!prev || prev.score !== val.score || prev.reasoning !== val.reasoning) paramChanges++;
            merged.__bot_parameters[key] = { score: val.score, reasoning: val.reasoning };
          }
        }

        for (const [key, val] of Object.entries(parameters) as [string, any][]) {
          if (key === '__needs_kb_update') {
            merged['__needs_kb_update'] = val;
          } else if (!key.startsWith('__')) {
            const prev = existingParams[key];
            if (!prev || prev.score !== val.score || prev.reasoning !== val.reasoning) paramChanges++;
            const cell = { score: val.score, reasoning: val.reasoning };
            merged[key] = cell;
            if (merged.__agent_parameters) {
              merged.__agent_parameters[key] = cell;
            }
            if (isBot && merged.__bot_parameters) {
              merged.__bot_parameters[key] = cell;
            }
          }
        }
        if (note) merged['__review_note'] = note;
        finalMergedParams = merged;

        const pascalScores: Record<string, ParamScore> = {};
        const safeAgentParams = {
          ...(merged.__agent_parameters || {}),
          ...merged,
        };
        for (const [dbKey, val] of Object.entries(safeAgentParams) as [string, any][]) {
          if (dbKey.startsWith('__')) continue;
          const pascal = DB_TO_PASCAL[dbKey] || dbKey;
          if (pascal && val && typeof val === 'object') {
            pascalScores[pascal] = val.score === true || val.score === 1
              ? 'Yes'
              : val.score === false || val.score === 0
              ? 'No'
              : val.score === 0.5
              ? 'Half'
              : 'NA';
          }
        }
        
        const botPascalScores: Record<string, ParamScore> = {};
        const srcBotParams = merged.__bot_parameters || (isBot ? (merged.__agent_parameters || merged) : {});
        for (const [dbKey, val] of Object.entries(srcBotParams) as [string, any][]) {
          if (dbKey.startsWith('__')) continue;
          const pascal = DB_TO_PASCAL[dbKey] || dbKey;
          if (pascal) {
            botPascalScores[pascal] = val.score === true || val.score === 1
              ? 'Yes'
              : val.score === false || val.score === 0
              ? 'No'
              : val.score === 0.5
              ? 'Half'
              : 'NA';
          }
        }
        
        merged['__scores'] = {
          agent_iqs: isBot ? null : calculateIQS(pascalScores, false, isV4),
          bot_iqs: calculateIQS(Object.keys(botPascalScores).length ? botPascalScores : pascalScores, true, isV4),
        };
        const newIqs = isBot ? merged['__scores'].bot_iqs : merged['__scores'].agent_iqs;

        isScoreUpdated = (oldIqs !== null && newIqs !== null && oldIqs !== newIqs) || (paramChanges > 0);

        await query(
          `UPDATE iqs_scores
           SET parameters = $1, iqs_score = $2,
               reviewed_by = $3, reviewed_at = NOW(), review_note = $4,
               status = 'reviewed'
           WHERE chat_id = $5`,
          [JSON.stringify(merged), newIqs, email, note ?? null, chatId]
        );

        log.info(ROUTE, action, { chatId, reviewer: email, oldIqs, newIqs, paramChanges });
        await storeAppendAuditEntry({ id: randomUUID(), action: action === 'submit' ? 'review_submitted' : 'score_overridden', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { oldIqs, newIqs, paramChanges, note: note ?? null } } as IQSAuditEntry);
      } else {
        // action without parameter changes — just mark reviewed
        await query(
          `UPDATE iqs_scores
           SET reviewed_by = $1, reviewed_at = NOW(), review_note = $2, status = 'reviewed'
           WHERE chat_id = $3`,
          [email, note ?? null, chatId]
        );
        log.info(ROUTE, action, { chatId, reviewer: email, paramChanges: 0 });
        await storeAppendAuditEntry({ id: randomUUID(), action: 'review_submitted', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { note: note ?? null } } as IQSAuditEntry);
      }

      // For resolve: mark the KV flag as reviewed
      if (action === 'resolve' && flagId) {
        const autoNote = isScoreUpdated ? 'Score updated by QA' : 'Resolved by QA (No score change)';
        const finalNote = note ? (isScoreUpdated && !note.toLowerCase().includes('score') ? `${note} (Score updated)` : note) : autoNote;

        await storeUpdateIQSFlag(flagId, {
          status:     'reviewed',
          reviewedBy: email,
          reviewedAt: new Date().toISOString(),
          reviewNote: finalNote,
        });
        log.info(ROUTE, 'flag resolved', { chatId, flagId, reviewer: email, isScoreUpdated });
        await storeAppendAuditEntry({ id: randomUUID(), action: 'dispute_resolved', chatId, actorEmail: email, actorRole: role, ts: new Date().toISOString(), meta: { flagId, note: finalNote } } as IQSAuditEntry);
      }

      // Fire Slack alert for KB Change if __needs_kb_update is marked
      const checkKbMarked = finalMergedParams?.__needs_kb_update?.score === true ||
        finalMergedParams?.__needs_kb_update?.score === 'true' ||
        finalMergedParams?.__needs_kb_update === true;

      if (checkKbMarked) {
        try {
          const convRows = await query<{ assigned_agent: string; disposition: string; sub_disposition: string }>(
            `SELECT tags->>'assigned_agent' AS assigned_agent,
                    tags->>'disposition' AS disposition,
                    tags->>'sub_disposition' AS sub_disposition
             FROM conversations WHERE id = $1`,
            [chatId]
          );
          const convInfo = convRows[0];
          await fireKbChangeAlert({
            chatId,
            reviewerEmail: email,
            reviewNote: note,
            agentName: convInfo?.assigned_agent,
            disposition: convInfo?.disposition,
            subDisposition: convInfo?.sub_disposition,
          });
        } catch (err: any) {
          log.error(ROUTE, 'fireKbChangeAlert error', { chatId, err: err?.message });
        }
      }
    } else if (action === 'reopen') {

      await query(
        `UPDATE iqs_scores
         SET status = 'reopened', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, scored_at = NOW()
         WHERE chat_id = $1`,
        [chatId]
      );
      log.info(ROUTE, 'reopen', { chatId, actor: email });
      await storeAppendAuditEntry({
        id: randomUUID(),
        action: 'review_reopened',
        chatId,
        actorEmail: email,
        actorRole: role,
        ts: new Date().toISOString(),
        meta: { note: note ?? null }
      } as IQSAuditEntry);
    }

    if (['submit', 'override', 'resolve'].includes(action)) {
      const afterState = await query<{ iqs_score: number; parameters: any }>(
        `SELECT iqs_score, parameters FROM iqs_scores WHERE chat_id = $1`, [chatId]
      );
      if (afterState.length > 0) {
        await query(
          `INSERT INTO chat_review_comparisons (
            chat_id, ai_score, human_score, ai_parameters, human_parameters, action, reviewed_by, review_note, reviewed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (chat_id) DO UPDATE SET
            human_score = EXCLUDED.human_score,
            human_parameters = EXCLUDED.human_parameters,
            action = EXCLUDED.action,
            reviewed_by = EXCLUDED.reviewed_by,
            review_note = EXCLUDED.review_note,
            reviewed_at = EXCLUDED.reviewed_at`,
          [
            chatId,
            oldScore,
            afterState[0].iqs_score,
            oldParams ? JSON.stringify(oldParams) : null,
            JSON.stringify(afterState[0].parameters),
            action,
            email,
            note ?? null
          ]
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    log.error(ROUTE, 'error', { chatId, action, err: e.message ?? String(e) });
    return NextResponse.json({ error: e.message ?? 'Internal error' }, { status: 500 });
  }
}
