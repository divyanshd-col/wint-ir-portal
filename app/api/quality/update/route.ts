import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { calculateIQS } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';

const PARAM_KEYS = ['Technical','AllQuestions','Expectation','Contextual','FollowUp','Sentences','Process','Opening','Call','Grammar','Empathy'];

// PascalCase frontend key → DB snake_case key
const LEGACY_TO_DB: Record<string, string> = {
  Technical:    'technical',
  AllQuestions: 'all_questions',
  Expectation:  'expectation',
  Contextual:   'contextual',
  FollowUp:     'follow_up',
  Sentences:    'sentences',
  Process:      'process',
  Opening:      'opening',
  Call:         'call',
  Grammar:      'grammar',
  Empathy:      'empathy',
};

function qualityAccess(session: any) {
  return ['admin', 'quality', 'tl'].includes(session?.user?.role);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const { id, chatId, scores, reasoning, agentName, disposition, subDisposition, csat, note } = body;
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  // Validate scores if provided
  const validScoreValues: ParamScore[] = ['Yes', 'No', 'NA'];
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
    if (scores || reasoning || note) {
      let params = rowExists ? (existing[0].parameters || {}) : {};
      if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

      // Normalise existing params: migrate any legacy PascalCase keys to snake_case
      // so we don't accumulate both formats after repeated overrides.
      const normalised: Record<string, any> = {};
      for (const [k, v] of Object.entries(params)) {
        if (k.startsWith('__')) { normalised[k] = v; continue; }
        const snakeKey = LEGACY_TO_DB[k] ?? k;
        normalised[snakeKey] = v;
      }
      params = normalised;

      if (scores) {
        for (const [legacyKey, val] of Object.entries(scores) as [string, string][]) {
          const dbKey = LEGACY_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
          if (!params[dbKey]) params[dbKey] = {};
          params[dbKey].score = val === 'Yes' ? true : val === 'No' ? false : null;
          if (reasoning?.[legacyKey] !== undefined) params[dbKey].reasoning = reasoning[legacyKey];
        }
      }

      if (reasoning) {
        for (const [legacyKey, text] of Object.entries(reasoning) as [string, string][]) {
          const dbKey = LEGACY_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
          if (!params[dbKey]) params[dbKey] = {};
          params[dbKey].reasoning = text;
        }
      }

      if (note) params['__review_note'] = note;

      const newIqs = scores ? calculateIQS(scores) : (rowExists ? existing[0].iqs_score : 0);

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

    const finalIqs = scores ? calculateIQS(scores) : (rowExists ? existing[0].iqs_score : 0);

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
