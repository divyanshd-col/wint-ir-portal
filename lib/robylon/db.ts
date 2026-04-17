import { query } from '@/lib/cx/db';

// ── Agent helpers ─────────────────────────────────────────────────────────────

/** Get or create an agent by name. Returns agent.id */
export async function upsertAgent(name: string): Promise<number | null> {
  if (!name) return null;
  const existing = await query<{ id: number }>(`SELECT id FROM agents WHERE name = $1`, [name]);
  if (existing.length) return existing[0].id;
  const rows = await query<{ id: number }>(
    `INSERT INTO agents (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name],
  );
  return rows[0]?.id ?? null;
}

export async function getAgentName(agentId: number): Promise<string> {
  const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE id = $1`, [agentId]);
  return rows[0]?.name ?? '';
}

// ── Contact helpers ───────────────────────────────────────────────────────────

/** Upsert a contact by phone number. Returns contact.id */
export async function upsertContact(phone: string | undefined): Promise<number | null> {
  if (!phone) return null;
  const rows = await query<{ id: number }>(
    `INSERT INTO contacts (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
    [phone],
  );
  return rows[0]?.id ?? null;
}

// ── Conversation helpers ──────────────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  contact_id: number | null;
  agent_id: number | null;
  conversation_type: string | null;
  started_at: string | null;
  closed_at: string | null;
  csat_score: number | null;
  csat_label: string | null;
  transcript: any;
  tags: any;
  frt_seconds: number | null;
  bot_to_team_seconds: number | null;
  resolution_seconds: number | null;
}

export async function upsertConversation(data: {
  id: string;
  contactId?: number | null;
  agentId?: number | null;
  conversationType?: string;
  startedAt?: string;
  closedAt?: string;
  transcript?: any;
  tags?: any;
  frtSeconds?: number | null;
  botToTeamSeconds?: number | null;
  resolutionSeconds?: number | null;
  rawPayload?: any;
  webhookTrigger?: string;
}): Promise<void> {
  await query(`
    INSERT INTO conversations (
      id, contact_id, agent_id, conversation_type,
      started_at, closed_at, transcript, tags,
      frt_seconds, bot_to_team_seconds, resolution_seconds,
      raw_payload, webhook_trigger, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT (id) DO UPDATE SET
      contact_id          = COALESCE(EXCLUDED.contact_id, conversations.contact_id),
      agent_id            = COALESCE(EXCLUDED.agent_id, conversations.agent_id),
      conversation_type   = COALESCE(EXCLUDED.conversation_type, conversations.conversation_type),
      started_at          = COALESCE(EXCLUDED.started_at, conversations.started_at),
      closed_at           = COALESCE(EXCLUDED.closed_at, conversations.closed_at),
      transcript          = COALESCE(EXCLUDED.transcript, conversations.transcript),
      tags                = COALESCE(EXCLUDED.tags, conversations.tags),
      frt_seconds         = COALESCE(EXCLUDED.frt_seconds, conversations.frt_seconds),
      bot_to_team_seconds = COALESCE(EXCLUDED.bot_to_team_seconds, conversations.bot_to_team_seconds),
      resolution_seconds  = COALESCE(EXCLUDED.resolution_seconds, conversations.resolution_seconds),
      raw_payload         = COALESCE(EXCLUDED.raw_payload, conversations.raw_payload),
      webhook_trigger     = COALESCE(EXCLUDED.webhook_trigger, conversations.webhook_trigger),
      updated_at          = NOW()
  `, [
    data.id,
    data.contactId ?? null,
    data.agentId ?? null,
    data.conversationType ?? null,
    data.startedAt ?? null,
    data.closedAt ?? null,
    data.transcript ? JSON.stringify(data.transcript) : null,
    data.tags ? JSON.stringify(data.tags) : null,
    data.frtSeconds ?? null,
    data.botToTeamSeconds ?? null,
    data.resolutionSeconds ?? null,
    data.rawPayload ? JSON.stringify(data.rawPayload) : null,
    data.webhookTrigger ?? null,
  ]);
}

export async function updateConversationCsat(
  chatId: string,
  csatScore: number,
  csatLabel: string,
): Promise<void> {
  await query(
    `UPDATE conversations SET csat_score = $1, csat_label = $2, updated_at = NOW() WHERE id = $3`,
    [csatScore, csatLabel, chatId],
  );
}

export async function updateConversationTags(
  chatId: string,
  tags: { disposition: string; sub_disposition: string },
): Promise<void> {
  await query(
    `UPDATE conversations SET tags = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(tags), chatId],
  );
}

export async function getConversation(chatId: string): Promise<ConversationRow | null> {
  const rows = await query<ConversationRow>(`SELECT * FROM conversations WHERE id = $1`, [chatId]);
  return rows[0] ?? null;
}

export async function isScored(chatId: string): Promise<boolean> {
  const rows = await query<{ chat_id: string }>(`SELECT chat_id FROM iqs_scores WHERE chat_id = $1`, [chatId]);
  return rows.length > 0;
}

// ── IQS score helpers ─────────────────────────────────────────────────────────

export interface IQSParameterResult {
  score: boolean | null;  // true=Yes, false=No, null=NA
  reasoning: string;
}

export async function insertIQSScore(data: {
  chatId: string;
  iqsScore: number;
  parameters: Record<string, IQSParameterResult>;
  modelVersion: string;
}): Promise<void> {
  await query(`
    INSERT INTO iqs_scores (chat_id, iqs_score, parameters, model_version, scored_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      iqs_score     = EXCLUDED.iqs_score,
      parameters    = EXCLUDED.parameters,
      model_version = EXCLUDED.model_version,
      scored_at     = NOW()
  `, [data.chatId, data.iqsScore, JSON.stringify(data.parameters), data.modelVersion]);
}

/** Update CSAT on conversations table — called from CSAT_SUBMITTED */
export async function updateIQSCsat(chatId: string, csatScore: number, csatLabel: string): Promise<boolean> {
  await updateConversationCsat(chatId, csatScore, csatLabel);
  return true;
}

// ── Fetch all scored conversations (for quality dashboard) ────────────────────

export async function getAllScoredConversations(limit = 2000): Promise<any[]> {
  return query(`
    SELECT
      c.id                  AS "chatId",
      c.started_at::date    AS "date",
      c.conversation_type   AS "conversationType",
      c.frt_seconds         AS "frt",
      c.bot_to_team_seconds AS "botToTeamSecs",
      c.resolution_seconds  AS "resolutionTime",
      c.csat_score,
      c.csat_label,
      c.tags,
      a.name                AS "agentName",
      s.iqs_score           AS "iqs",
      s.parameters,
      s.model_version       AS "modelVersion",
      s.scored_at           AS "scoredAt"
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ORDER BY s.scored_at DESC
    LIMIT $1
  `, [limit]);
}

/** Get conversations ready to score (have transcript + tags but no iqs_scores row) */
export async function getUnscoredConversations(): Promise<ConversationRow[]> {
  return query<ConversationRow>(`
    SELECT c.*
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE s.chat_id IS NULL
      AND c.transcript IS NOT NULL
      AND c.tags IS NOT NULL
      AND c.closed_at < NOW() - INTERVAL '12 hours'
    ORDER BY c.closed_at ASC
    LIMIT 50
  `);
}
