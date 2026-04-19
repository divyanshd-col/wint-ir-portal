import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { calculateIQS } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';

const PARAM_KEYS = ['Technical','AllQuestions','Expectation','Contextual','FollowUp','Sentences','Process','Opening','Call','Tags','Grammar','Empathy'];

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
  Tags:         'tags',
  Grammar:      'grammar',
  Empathy:      'empathy',
};

function qualityAccess(session: any) {
  return ['admin', 'quality', 'tl'].includes(session?.user?.role);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, chatId, scores, reasoning, agentName, disposition, subDisposition, csat, summary, note } = body;
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

  // Check the iqs_scores row exists
  const existing = await query<{ chat_id: string; parameters: any; iqs_score: number }>(
    `SELECT chat_id, parameters, iqs_score FROM iqs_scores WHERE chat_id = $1`, [chatId]
  );
  if (!existing.length) {
    return NextResponse.json({ error: 'Entry not found in database — score may not have been generated yet.' }, { status: 404 });
  }

  const updatedBy = session.user?.email || session.user?.name || 'unknown';

  // ── Update iqs_scores (parameters + iqs_score) ────────────────────────────
  if (scores) {
    // Merge new scores into existing parameters (keep existing reasoning unless provided)
    let params = existing[0].parameters || {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    for (const [legacyKey, val] of Object.entries(scores) as [string, string][]) {
      const dbKey = LEGACY_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
      if (!params[dbKey]) params[dbKey] = {};
      params[dbKey].score = val === 'Yes' ? true : val === 'No' ? false : null;
      if (reasoning && reasoning[legacyKey] !== undefined) {
        params[dbKey].reasoning = reasoning[legacyKey];
      }
    }

    // If reasoning provided for keys not in scores, apply them too
    if (reasoning) {
      for (const [legacyKey, text] of Object.entries(reasoning) as [string, string][]) {
        const dbKey = LEGACY_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
        if (!params[dbKey]) params[dbKey] = {};
        params[dbKey].reasoning = text;
      }
    }

    const newIqs = calculateIQS(scores);
    await query(
      `UPDATE iqs_scores SET parameters = $1, iqs_score = $2, scored_at = scored_at WHERE chat_id = $3`,
      [JSON.stringify(params), newIqs, chatId]
    );
  } else if (reasoning) {
    // Reasoning-only update
    let params = existing[0].parameters || {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }
    for (const [legacyKey, text] of Object.entries(reasoning) as [string, string][]) {
      const dbKey = LEGACY_TO_DB[legacyKey] ?? legacyKey.toLowerCase();
      if (!params[dbKey]) params[dbKey] = {};
      params[dbKey].reasoning = text;
    }
    await query(
      `UPDATE iqs_scores SET parameters = $1, scored_at = scored_at WHERE chat_id = $2`,
      [JSON.stringify(params), chatId]
    );
  }

  // ── Update conversations (csat, tags, agent) ──────────────────────────────
  const convUpdates: string[] = [];
  const convParams: any[] = [];

  if (csat !== undefined) {
    convParams.push(csat ? parseInt(csat) : null);
    convUpdates.push(`csat_score = $${convParams.length}`);
    convParams.push(csat === '5' ? 'Good' : csat === '3' ? 'Neutral' : csat === '1' ? 'Bad' : null);
    convUpdates.push(`csat_label = $${convParams.length}`);
  }

  if (disposition !== undefined || subDisposition !== undefined) {
    // Fetch existing tags to merge
    const convRow = await query<{ tags: any }>(`SELECT tags FROM conversations WHERE id = $1`, [chatId]);
    let existingTags: any = convRow[0]?.tags || {};
    if (typeof existingTags === 'string') { try { existingTags = JSON.parse(existingTags); } catch { existingTags = {}; } }
    if (disposition !== undefined) existingTags.disposition = disposition;
    if (subDisposition !== undefined) existingTags.sub_disposition = subDisposition;
    convParams.push(JSON.stringify(existingTags));
    convUpdates.push(`tags = $${convParams.length}`);
  }

  if (agentName !== undefined) {
    // Upsert agent and get/create id
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

  const newIqs = scores ? calculateIQS(scores) : existing[0].iqs_score;

  return NextResponse.json({
    ok: true,
    entry: {
      id: id || `${new Date().toISOString()}-${chatId}`,
      chatId,
      iqs: newIqs,
      scores,
      reasoning,
      agentName,
      disposition,
      subDisposition,
      csat,
      updatedBy,
      updatedAt: new Date().toISOString(),
    },
  });
}
