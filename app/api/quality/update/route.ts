import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { PASCAL_TO_DB } from '@/lib/param-keys';
import { query } from '@/lib/cx/db';
import { calculateIQS, isV4Evaluation } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';

const PARAM_KEYS = [
  'Technical','AllQuestions','Expectation','Contextual','FollowUp','Sentences','Process','Opening','Call','Grammar','Empathy',
  'IssueResolution', 'Accuracy', 'CorrectEscalation', 'NoRepetition', 'Personalization', 'ExpectationSetting', 'Clarity'
];

// Bot-distinctive keys — never appear in the human rubric. Shared keys
// (IssueResolution/Accuracy/Personalization) must NOT be used to detect a bot chat.
const BOT_ONLY_PASCAL = ['CorrectEscalation', 'NoRepetition', 'ExpectationSetting', 'Clarity'];
const BOT_ONLY_SNAKE  = ['correct_escalation', 'no_repetition', 'expectation_setting', 'clarity'];

export async function PATCH(req: NextRequest) {
  // TL is view-only for chat quality — only QA/admin may override scores.
  const { session, response } = await requireRole(['admin', 'quality']);
  if (response) return response;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const { id, chatId, scores, reasoning, gates, agentName, disposition, subDisposition, csat, note, isKbChange, needsKbUpdate } = body;
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  // Validate scores if provided
  const validScoreValues: ParamScore[] = ['Yes', 'No', 'NA', 'Half'];
  if (scores) {
    for (const [k, v] of Object.entries(scores)) {
      if (PARAM_KEYS.includes(k) && !validScoreValues.includes(v as ParamScore)) {
        return NextResponse.json({ error: `Invalid score value for ${k}: ${v}` }, { status: 400 });
      }
    }
  }

  try {
    // Fetch existing iqs_scores row (may not exist for older Redis-only scores)
    const existing = await query<{ chat_id: string; parameters: any; iqs_score: number }>(
      `SELECT chat_id, parameters, iqs_score FROM iqs_scores WHERE chat_id = $1`, [chatId]
    );
    const rowExists = existing.length > 0;

    const updatedBy = session.user?.email || session.user?.name || 'unknown';

    // ── Upsert iqs_scores (parameters + iqs_score) ────────────────────────────
    const hasKbToggle = needsKbUpdate !== undefined || isKbChange !== undefined;
    if (scores || reasoning || note || hasKbToggle || gates) {
      let params = rowExists ? (existing[0].parameters || {}) : {};
      if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

      // Normalise existing params: migrate any legacy PascalCase keys to snake_case
      // so we don't accumulate both formats after repeated overrides.
      const normalised: Record<string, any> = {};
      for (const [k, v] of Object.entries(params)) {
        if (k.startsWith('__')) { normalised[k] = v; continue; }
        const snakeKey = PASCAL_TO_DB[k] ?? k;
        normalised[snakeKey] = v;
      }
      params = normalised;

      if (scores) {
        for (const [legacyKey, val] of Object.entries(scores) as [string, string][]) {
          const dbKey = PASCAL_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
          if (!params[dbKey]) params[dbKey] = {};
          const scoreVal = val === 'Yes' ? true : val === 'No' ? false : val === 'Half' ? 0.5 : null;
          params[dbKey].score = scoreVal;
          if (reasoning?.[legacyKey] !== undefined) params[dbKey].reasoning = reasoning[legacyKey];

          if (params.__agent_parameters) {
            if (!params.__agent_parameters[dbKey]) params.__agent_parameters[dbKey] = {};
            params.__agent_parameters[dbKey].score = scoreVal;
            if (reasoning?.[legacyKey] !== undefined) params.__agent_parameters[dbKey].reasoning = reasoning[legacyKey];
          }
        }
      }

      if (reasoning) {
        for (const [legacyKey, text] of Object.entries(reasoning) as [string, string][]) {
          const dbKey = PASCAL_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
          if (!params[dbKey]) params[dbKey] = {};
          params[dbKey].reasoning = text;

          if (params.__agent_parameters) {
            if (!params.__agent_parameters[dbKey]) params.__agent_parameters[dbKey] = {};
            params.__agent_parameters[dbKey].reasoning = text;
          }
        }
      }

      if (hasKbToggle) {
        const kbVal = Boolean(needsKbUpdate ?? isKbChange);
        params['__needs_kb_update'] = { score: kbVal, reasoning: '' };
      }

      if (gates) params['__gates'] = gates;

      if (note) params['__review_note'] = note;

      const convRow = await query<{ conversation_type: string }>(`SELECT conversation_type FROM conversations WHERE id = $1`, [chatId]);
      const existingParamsObj = rowExists && existing[0]?.parameters
        ? (existing[0].parameters.__agent_parameters || existing[0].parameters.__bot_parameters || existing[0].parameters)
        : {};
      const hasBotParams = scores
        ? Object.keys(scores).some(k => BOT_ONLY_PASCAL.includes(k))
        : Object.keys(existingParamsObj).some(k => BOT_ONLY_SNAKE.includes(k));
      const convType = convRow[0]?.conversation_type;
      const isBot = convType === 'bot' || (convType !== 'agent' && convType !== 'hybrid' && hasBotParams);
      const isV4 = rowExists ? isV4Evaluation(existing[0].parameters) : true;
      const newIqs = scores ? calculateIQS(scores, isBot, isV4) : (rowExists ? existing[0].iqs_score : 0);

      if (rowExists) {
        await query(
          `UPDATE iqs_scores
           SET parameters = $1, iqs_score = $2, review_note = $3
           WHERE chat_id = $4`,
          [JSON.stringify(params), newIqs, note || null, chatId]
        );
      } else {
        await query(
          `INSERT INTO iqs_scores (chat_id, parameters, iqs_score, scored_at, review_note)
           VALUES ($1, $2, $3, NOW(), $4)`,
          [chatId, JSON.stringify(params), newIqs, note || null]
        );
      }
      console.log(`[quality/update] Saved override for ${chatId}: iqs=${newIqs}, by=${updatedBy}`);

      if (params['__needs_kb_update']?.score === true) {
        try {
          const { fireKbChangeAlert } = await import('@/lib/quality-alert');
          const convRows = await query<{ assigned_agent: string; disposition: string; sub_disposition: string }>(
            `SELECT tags->>'assigned_agent' AS assigned_agent,
                    tags->>'disposition' AS disposition,
                    tags->>'sub_disposition' AS sub_disposition
             FROM conversations WHERE id = $1`,
            [chatId]
          );
          const convInfo = convRows[0];
          const kbCommentNote = params['__needs_kb_update']?.reasoning || note;
          await fireKbChangeAlert({
            chatId,
            reviewerEmail: updatedBy,
            reviewNote: kbCommentNote,
            agentName: agentName || convInfo?.assigned_agent,
            disposition: disposition || convInfo?.disposition,
            subDisposition: subDisposition || convInfo?.sub_disposition,
          });
        } catch (err: any) {
          console.error('[quality/update] fireKbChangeAlert error:', err?.message);
        }
      }
    }

    // ── Update conversations (csat, tags, agent) ──────────────────────────────
    const convUpdates: string[] = [];
    const convParams: any[] = [];

    if (csat !== undefined) {
      const csatNum = csat ? parseInt(csat) : null;
      const csatLbl = csat === '5' ? 'good' : csat === '3' ? 'could_be_better' : csat === '1' ? 'bad' : null;
      convParams.push(isNaN(csatNum as any) ? null : csatNum);
      convUpdates.push(`csat_score = $${convParams.length}`);
      convParams.push(csatLbl);
      convUpdates.push(`csat_label = $${convParams.length}`);
    }

    if (disposition !== undefined || subDisposition !== undefined) {
      const convRow = await query<{ tags: any }>(`SELECT tags FROM conversations WHERE id = $1`, [chatId]);
      let existingTags: any = convRow[0]?.tags || {};
      if (typeof existingTags === 'string') { try { existingTags = JSON.parse(existingTags); } catch { existingTags = {}; } }
      if (disposition !== undefined) existingTags.disposition = disposition;
      if (subDisposition !== undefined) existingTags.sub_disposition = subDisposition;
      convParams.push(JSON.stringify(existingTags));
      convUpdates.push(`tags = $${convParams.length}`);
    }

    if (agentName !== undefined && agentName !== '') {
      const agentRows = await query<{ id: number }>(
        `INSERT INTO agents (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [agentName]
      );
      if (agentRows[0]?.id) {
        convParams.push(agentRows[0].id);
        convUpdates.push(`agent_id = $${convParams.length}`);
      }
    }

    if (convUpdates.length) {
      convParams.push(chatId);
      await query(
        `UPDATE conversations SET ${convUpdates.join(', ')}, updated_at = NOW() WHERE id = $${convParams.length}`,
        convParams
      );
    }

    const convRow = await query<{ conversation_type: string }>(`SELECT conversation_type FROM conversations WHERE id = $1`, [chatId]);
    const convType2 = convRow[0]?.conversation_type;
    const existingParamsObj2 = rowExists && existing[0]?.parameters
      ? (existing[0].parameters.__agent_parameters || existing[0].parameters.__bot_parameters || existing[0].parameters)
      : {};
    const hasBotParams2 = scores
      ? Object.keys(scores).some(k => BOT_ONLY_PASCAL.includes(k))
      : Object.keys(existingParamsObj2).some(k => BOT_ONLY_SNAKE.includes(k));
    const isBot = convType2 === 'bot' || (convType2 !== 'agent' && convType2 !== 'hybrid' && hasBotParams2);
    const isTransferred = convType2 === 'hybrid' || convType2 === 'agent';
    const isV4b = rowExists ? isV4Evaluation(existing[0].parameters) : true;
    const finalIqs = scores ? calculateIQS(scores, isBot, isV4b) : (rowExists ? existing[0].iqs_score : 0);

    if (scores && isBot && !isTransferred) {
      const { fireBotQualityAlert } = await import('@/lib/quality-alert');
      fireBotQualityAlert({
        chatId,
        agentName,
        scores,
        reasoning,
        iqs: finalIqs,
        disposition,
        subDisposition,
        conversationType: convType2 || 'bot',
        isTransferred: false,
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      entry: {
        id: id || `${new Date().toISOString()}-${chatId}`,
        chatId,
        iqs: finalIqs,
        scores,
        reasoning,
        agentName,
        disposition,
        subDisposition,
        csat,
        updatedBy,
        updatedAt: new Date().toISOString(),
        ...(note ? { reviewNote: note } : {}),
      },
    });
  } catch (err: any) {
    console.error('[quality/update] PATCH error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 });
  }
}
