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

/** Returns agent names whose tl_name matches (case-insensitive). */
export async function getAgentNamesByTL(tlName: string): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM agents WHERE LOWER(tl_name) = LOWER($1)`, [tlName]
  );
  return rows.map(r => r.name);
}

/** Returns agent names whose qa_name matches (case-insensitive). */
export async function getAgentNamesByQA(qaName: string): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM agents WHERE LOWER(qa_name) = LOWER($1)`, [qaName]
  );
  return rows.map(r => r.name);
}

// ── Contact helpers ───────────────────────────────────────────────────────────

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Upsert a contact by phone number. Returns contact.id */
export async function upsertContact(phone: string | undefined): Promise<number | null> {
  if (!phone) return null;
  const normalised = phone.trim().slice(0, 50);
  const rows = await query<{ id: number }>(
    `INSERT INTO contacts (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
    [normalised],
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

export async function getLatestConversationByPhone(phone: string): Promise<any | null> {
  const rows = await query<any>(`
    SELECT c.id AS "chatId", c.closed_at AS "closedAt", c.tags,
           c.agent_id AS "agentId", a.name AS "agentName"
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE ct.phone = $1
      AND c.closed_at IS NOT NULL
    ORDER BY c.closed_at DESC
    LIMIT 1
  `, [phone]);
  return rows[0] ?? null;
}

export async function getConversationHistory(chatId: string, limit = 10): Promise<any[]> {
  return query(`
    SELECT c.id AS "chatId", c.started_at::date AS "date",
           c.conversation_type AS "conversationType", c.csat_score, c.tags,
           a.name AS "agentName", s.iqs_score AS "iqs", s.scored_at AS "scoredAt"
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.contact_id = (SELECT contact_id FROM conversations WHERE id = $1)
      AND c.id != $1 AND c.contact_id IS NOT NULL
    ORDER BY c.started_at DESC
    LIMIT $2
  `, [chatId, limit]);
}

export async function findConversationByPhoneAndDate(phone: string, date: string): Promise<ConversationRow | null> {
  const last10 = phone.replace(/\D/g, '').slice(-10);
  if (!last10) return null;
  const rows = await query<ConversationRow>(`
    SELECT c.* FROM conversations c
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE (RIGHT(COALESCE(c.phone_number, ''), 10) = $1 OR RIGHT(COALESCE(ct.phone, ''), 10) = $1)
      AND c.closed_at::date = $2::date
    ORDER BY c.closed_at DESC LIMIT 1
  `, [last10, date]);
  return rows[0] ?? null;
}

export async function claimCallForScoring(callId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE call_recordings SET status = 'scoring', updated_at = NOW()
     WHERE id = $1 AND status = 'linked' RETURNING id`,
    [callId],
  );
  return rows.length > 0;
}

export async function getConversationsWithUnscoredLinkedCalls(): Promise<ConversationRow[]> {
  await query(`
    UPDATE call_recordings SET status = 'linked', updated_at = NOW()
    WHERE status = 'scoring' AND updated_at < NOW() - INTERVAL '30 minutes'
  `, []);
  return query<ConversationRow>(`
    SELECT DISTINCT c.* FROM conversations c
    JOIN call_recordings cr ON cr.chat_id = c.id
    WHERE cr.status = 'linked' AND c.tags IS NOT NULL
      AND c.closed_at < NOW() - INTERVAL '30 minutes'
    ORDER BY c.closed_at ASC LIMIT 50
  `, []);
}

export async function isScored(chatId: string): Promise<boolean> {
  const rows = await query<{ chat_id: string }>(`SELECT chat_id FROM iqs_scores WHERE chat_id = $1`, [chatId]);
  return rows.length > 0;
}

// ── IQS score helpers ─────────────────────────────────────────────────────────

export interface IQSParameterResult {
  score: boolean | null;  // true=Yes, false=No, null=NA
  reasoning: string;
  kbCitation?: string;
}

export async function insertIQSScore(data: {
  chatId: string;
  iqsScore: number;
  parameters: Record<string, IQSParameterResult>;
  modelVersion: string;
  uncertainParameters?: Array<{ parameter: string; question: string }>;
}): Promise<void> {
  const stored: Record<string, any> = { ...data.parameters };
  if (data.uncertainParameters && data.uncertainParameters.length > 0) {
    stored.__uncertain = data.uncertainParameters;
  }
  await query(`
    INSERT INTO iqs_scores (chat_id, iqs_score, parameters, model_version, scored_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      iqs_score     = EXCLUDED.iqs_score,
      parameters    = EXCLUDED.parameters,
      model_version = EXCLUDED.model_version,
      scored_at     = NOW()
  `, [data.chatId, data.iqsScore, JSON.stringify(stored), data.modelVersion]);
}

/** Update CSAT on conversations table — called from CSAT_SUBMITTED */
export async function updateIQSCsat(chatId: string, csatScore: number, csatLabel: string): Promise<boolean> {
  await updateConversationCsat(chatId, csatScore, csatLabel);
  return true;
}

// ── Fetch all scored conversations (for quality dashboard) ────────────────────

export async function getAllScoredConversations(
  limit = 0,
  opts: { dateFrom?: string; dateTo?: string; agentName?: string; agentNames?: string[]; iqsMin?: number; iqsMax?: number; includeUncertain?: boolean; disposition?: string; subDisposition?: string } = {},
): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    conditions.push(`c.started_at::date >= $${params.length}`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    conditions.push(`c.started_at::date <= $${params.length}`);
  }
  if (opts.iqsMin !== undefined && opts.iqsMin > 0) {
    params.push(opts.iqsMin);
    conditions.push(`s.iqs_score >= $${params.length}`);
  }
  if (opts.iqsMax !== undefined) {
    params.push(opts.iqsMax);
    if (opts.includeUncertain) {
      conditions.push(`(s.iqs_score <= $${params.length} OR s.parameters ? '__uncertain')`);
    } else {
      conditions.push(`s.iqs_score <= $${params.length}`);
    }
  } else if (opts.includeUncertain) {
    conditions.push(`s.parameters ? '__uncertain'`);
  }
  if (opts.agentName) {
    params.push(opts.agentName);
    conditions.push(`a.name = $${params.length}`);
  } else if (opts.agentNames && opts.agentNames.length > 0) {
    params.push(opts.agentNames);
    conditions.push(`a.name = ANY($${params.length})`);
  } else if (opts.agentNames && opts.agentNames.length === 0) {
    // Scoped role with no assigned agents — return nothing
    conditions.push(`1=0`);
  }
  if (opts.disposition) {
    params.push(opts.disposition);
    conditions.push(`(c.tags->>'disposition') = $${params.length}`);
  }
  if (opts.subDisposition) {
    params.push(opts.subDisposition);
    conditions.push(`(c.tags->>'sub_disposition') = $${params.length}`);
  }

  const where    = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitSql = limit > 0 ? `LIMIT ${limit}` : '';

  return query(`
    SELECT
      c.id                        AS "chatId",
      c.started_at::date          AS "date",
      c.conversation_type         AS "conversationType",
      c.frt_seconds               AS "frt",
      c.bot_to_team_seconds       AS "botToTeamSecs",
      c.resolution_seconds        AS "resolutionTime",
      c.csat_score,
      c.csat_label,
      c.tags,
      c.tags->>'disposition'      AS "disposition",
      c.tags->>'sub_disposition'  AS "subDisposition",
      a.name                      AS "agentName",
      s.iqs_score                 AS "iqs",
      s.parameters,
      s.model_version             AS "modelVersion",
      s.scored_at                 AS "scoredAt",
      s.reviewed_by               AS "reviewedBy",
      s.reviewed_at               AS "reviewedAt",
      s.review_note               AS "reviewNote"
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
    ORDER BY s.scored_at DESC
    ${limitSql}
  `, params);
}

/** Get conversations ready to score (have transcript + tags but no iqs_scores row) */
export async function getUnscoredConversations(minHoursOld = 12): Promise<ConversationRow[]> {
  return query<ConversationRow>(`
    SELECT c.*
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE s.chat_id IS NULL
      AND c.transcript IS NOT NULL
      AND c.tags IS NOT NULL
      AND c.closed_at < NOW() - ($1 * INTERVAL '1 hour')
    ORDER BY c.closed_at ASC
    LIMIT 50
  `, [minHoursOld]);
}

export async function countUnscoredConversations(minHoursOld = 0): Promise<number> {
  const rows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE s.chat_id IS NULL
      AND c.transcript IS NOT NULL
      AND c.tags IS NOT NULL
      AND c.closed_at < NOW() - ($1 * INTERVAL '1 hour')
  `, [minHoursOld]);
  return parseInt(rows[0]?.count ?? '0', 10);
}

// ── Call recording helpers ────────────────────────────────────────────────────

export interface CallRecordingRow {
  id: string;
  chat_id: string | null;
  agent_id: number | null;
  contact_id: number | null;
  recording_url: string | null;
  duration_seconds: number | null;
  called_at: string | null;
  language: string | null;
  transcript: any;
  interruption_count: number;
  dead_air_count: number;
  status: string;
}

export async function insertCallRecording(data: {
  id: string;
  chatId?: string | null;
  agentId?: number | null;
  contactId?: number | null;
  recordingUrl?: string | null;
  durationSeconds?: number | null;
  calledAt?: string | null;
  language?: string | null;
  transcript?: any;
}): Promise<void> {
  await query(`
    INSERT INTO call_recordings (
      id, chat_id, agent_id, contact_id, recording_url,
      duration_seconds, called_at, language, transcript, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transcribed')
    ON CONFLICT (id) DO UPDATE SET
      chat_id          = COALESCE(EXCLUDED.chat_id, call_recordings.chat_id),
      agent_id         = COALESCE(EXCLUDED.agent_id, call_recordings.agent_id),
      contact_id       = COALESCE(EXCLUDED.contact_id, call_recordings.contact_id),
      recording_url    = COALESCE(EXCLUDED.recording_url, call_recordings.recording_url),
      duration_seconds = COALESCE(EXCLUDED.duration_seconds, call_recordings.duration_seconds),
      called_at        = COALESCE(EXCLUDED.called_at, call_recordings.called_at),
      language         = COALESCE(EXCLUDED.language, call_recordings.language),
      transcript       = COALESCE(EXCLUDED.transcript, call_recordings.transcript),
      updated_at       = NOW()
  `, [
    data.id,
    data.chatId ?? null,
    data.agentId ?? null,
    data.contactId ?? null,
    data.recordingUrl ?? null,
    data.durationSeconds ?? null,
    data.calledAt ?? null,
    data.language ?? null,
    data.transcript ? JSON.stringify(data.transcript) : null,
  ]);
}

export async function updateCallRecordingMetrics(data: {
  id: string;
  interruptionCount: number;
  deadAirCount: number;
  status: string;
}): Promise<void> {
  await query(`
    UPDATE call_recordings
    SET interruption_count = $1, dead_air_count = $2, status = $3, updated_at = NOW()
    WHERE id = $4
  `, [data.interruptionCount, data.deadAirCount, data.status, data.id]);
}

export async function getCallRecording(callId: string): Promise<CallRecordingRow | null> {
  const rows = await query<CallRecordingRow>(`SELECT * FROM call_recordings WHERE id = $1`, [callId]);
  return rows[0] ?? null;
}

/** Upsert call IQS scores into iqs_scores keyed by chat_id.
 *  Safe to call before or after the chat IQS row is created — ON CONFLICT merges. */
export async function updateCallIQSScore(data: {
  chatId: string;
  callIqsScore: number;
  callParameters: Record<string, IQSParameterResult>;
  callModelVersion: string;
}): Promise<void> {
  await query(`
    INSERT INTO iqs_scores (chat_id, call_iqs_score, call_parameters, call_model_version, call_scored_at)
    VALUES ($4, $1, $2, $3, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      call_iqs_score     = EXCLUDED.call_iqs_score,
      call_parameters    = EXCLUDED.call_parameters,
      call_model_version = EXCLUDED.call_model_version,
      call_scored_at     = NOW()
  `, [data.callIqsScore, JSON.stringify(data.callParameters), data.callModelVersion, data.chatId]);
}

/** Get the most recent call recording directly linked to a chat_id. */
export async function getCallRecordingByChatId(chatId: string): Promise<CallRecordingRow | null> {
  const rows = await query<CallRecordingRow>(
    `SELECT * FROM call_recordings WHERE chat_id = $1 ORDER BY called_at ASC NULLS LAST`,
    [chatId],
  );
  return rows[0] ?? null;
}

/** Get ALL call recordings directly linked to a chat_id (handles multiple calls per chat). */
export async function getAllCallRecordingsByChatId(chatId: string): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(
    `SELECT * FROM call_recordings WHERE chat_id = $1 ORDER BY called_at ASC NULLS LAST`,
    [chatId],
  );
}

/**
 * Find all call recordings that share the same contact as the given chat_id.
 *
 * This handles the case where Robylon creates separate ticket IDs for WhatsApp (e.g. 38007)
 * and voice call (e.g. 38252) for the same phone number. The call recording will have
 * chat_id=38252, but we need to find it when the user enters chat_id=38007.
 *
 * Strategy: join call_recordings → conversations (on call's chat_id) → match contact_id
 * to the input chat's contact_id. Does NOT require call_recordings.contact_id to be set.
 */
export async function getCallRecordingsByConversationContact(
  chatId: string,
): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(`
    SELECT cr.*
    FROM call_recordings cr
    JOIN conversations conv_call ON conv_call.id::text = cr.chat_id
    WHERE conv_call.contact_id IS NOT NULL
      AND conv_call.contact_id = (
        SELECT contact_id FROM conversations WHERE id = $1
      )
      AND cr.chat_id != $1
    ORDER BY cr.called_at ASC NULLS LAST, cr.created_at ASC
  `, [chatId]);
}

/**
 * Find all call recordings for a contact within a time window.
 * Fallback when call_recordings.chat_id is NULL or not linked to any conversation row.
 * Window is expanded by 1 hour on each side to handle clock skew.
 */
export async function getCallRecordingsByContactWindow(
  contactId: number,
  windowStart: string,
  windowEnd: string,
): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(`
    SELECT * FROM call_recordings
    WHERE contact_id = $1
      AND called_at >= $2::timestamptz - INTERVAL '1 hour'
      AND called_at <= $3::timestamptz + INTERVAL '1 hour'
    ORDER BY called_at ASC
  `, [contactId, windowStart, windowEnd]);
}

/** Find call recordings for a contact that have not yet been linked to a chat.
 *  Lower bound (startedAt - 15 min) prevents orphaned calls from older conversations
 *  being incorrectly linked to a newer chat when a backlog of NULL chat_ids exists. */
export async function getUnlinkedCallsForContact(
  contactId: number,
  startedAt: string,
  closedAt: string,
): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(`
    SELECT * FROM call_recordings
    WHERE contact_id = $1
      AND chat_id IS NULL
      AND called_at >= $2::timestamptz - INTERVAL '15 minutes'
      AND called_at <= $3::timestamptz
    ORDER BY called_at ASC
  `, [contactId, startedAt, closedAt]);
}

/** Find the closed conversation that a call belongs to, for self-linking after late transcription.
 *  Matches a conversation whose window (started_at - 15 min → closed_at) contains the call. */
export async function findClosedConversationForCall(
  contactId: number,
  calledAt: string,
): Promise<{ id: string } | null> {
  const rows = await query<{ id: string }>(`
    SELECT id FROM conversations
    WHERE contact_id = $1
      AND started_at - INTERVAL '15 minutes' <= $2::timestamptz
      AND closed_at >= $2::timestamptz
      AND closed_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [contactId, calledAt]);
  return rows[0] ?? null;
}

/** Backfill chat_id and advance status to 'linked' on a call recording. */
export async function linkCallToChat(callId: string, chatId: string): Promise<void> {
  await query(
    `UPDATE call_recordings
     SET chat_id = $1, status = 'linked', updated_at = NOW()
     WHERE id = $2`,
    [chatId, callId],
  );
}

/** Update only the status field on a call recording (e.g. 'scored'). */
export async function updateCallRecordingStatus(id: string, status: string): Promise<void> {
  await query(
    `UPDATE call_recordings SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id],
  );
}

/** Return all call recordings for a chat that are linked but not yet scored. */
export async function getLinkedUnscoredCallsForChat(chatId: string): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(
    `SELECT * FROM call_recordings WHERE chat_id = $1 AND status = 'linked' ORDER BY called_at ASC`,
    [chatId],
  );
}

export async function getAllScoredCalls(opts: {
  agentName?: string;
  agentNames?: string[];
  dateFrom?: string;
  dateTo?: string;
  minScore?: number;
  maxScore?: number;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: any[]; total: number }> {
  // Join call_recordings → iqs_scores (via chat_id) — call_iqs_score must exist
  const conditions: string[] = ['s.call_iqs_score IS NOT NULL'];
  const params: any[] = [];

  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    conditions.push(`r.called_at::date >= $${params.length}`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    conditions.push(`r.called_at::date <= $${params.length}`);
  }
  if (opts.minScore !== undefined) {
    params.push(opts.minScore);
    conditions.push(`s.call_iqs_score >= $${params.length}`);
  }
  if (opts.maxScore !== undefined) {
    params.push(opts.maxScore);
    conditions.push(`s.call_iqs_score <= $${params.length}`);
  }
  if (opts.agentName) {
    params.push(opts.agentName);
    conditions.push(`COALESCE(a.name, '') = $${params.length}`);
  } else if (opts.agentNames && opts.agentNames.length > 0) {
    params.push(opts.agentNames);
    conditions.push(`COALESCE(a.name, '') = ANY($${params.length})`);
  } else if (opts.agentNames && opts.agentNames.length === 0) {
    conditions.push('1=0');
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countRows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM call_recordings r
    JOIN iqs_scores s ON s.chat_id = r.chat_id
    LEFT JOIN conversations conv ON conv.id = r.chat_id
    LEFT JOIN agents a ON a.id = COALESCE(r.agent_id, conv.agent_id)
    ${where}
  `, params);
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const page     = opts.page ?? 0;
  const pageSize = opts.pageSize ?? 50;
  const offsetVal = page * pageSize;
  params.push(pageSize, offsetVal);

  const rows = await query(`
    SELECT
      r.id                                    AS "callId",
      r.chat_id                               AS "chatId",
      r.called_at                             AS "calledAt",
      r.called_at::date                       AS "date",
      r.duration_seconds                      AS "durationSeconds",
      r.language,
      r.interruption_count                    AS "interruptionCount",
      r.dead_air_count                        AS "deadAirCount",
      COALESCE(a.name, '')                    AS "agentName",
      s.call_iqs_score                        AS "iqs",
      s.call_parameters                       AS "parameters",
      s.call_model_version                    AS "modelVersion",
      s.call_scored_at                        AS "scoredAt"
    FROM call_recordings r
    JOIN iqs_scores s ON s.chat_id = r.chat_id
    LEFT JOIN conversations conv ON conv.id = r.chat_id
    LEFT JOIN agents a ON a.id = COALESCE(r.agent_id, conv.agent_id)
    ${where}
    ORDER BY r.called_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return { rows, total };
}

// ── Call disposition + chunking ───────────────────────────────────────────────

/** Store AI-classified disposition / sub-disposition on a call recording. */
export async function updateCallDisposition(
  callId: string,
  disposition: string,
  subDisposition: string,
): Promise<void> {
  await query(
    `UPDATE call_recordings
     SET call_disposition = $1, call_sub_disposition = $2, updated_at = NOW()
     WHERE id = $3`,
    [disposition, subDisposition, callId],
  );
}

export interface CallTranscriptChunk {
  callId: string;
  chatId?: string | null;
  contactId?: number | null;
  agentId?: number | null;
  calledAt?: string | null;
  topic: string;
  summary: string;
  content: string;
  chunkIndex: number;
}

/** Batch-insert topic chunks extracted from a call transcript. */
export async function insertCallTranscriptChunks(chunks: CallTranscriptChunk[]): Promise<void> {
  for (const c of chunks) {
    await query(
      `INSERT INTO call_transcript_chunks
         (call_id, chat_id, contact_id, agent_id, called_at, topic, summary, content, chunk_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.callId, c.chatId ?? null, c.contactId ?? null, c.agentId ?? null,
       c.calledAt ?? null, c.topic, c.summary, c.content, c.chunkIndex],
    );
  }
}

/** Retrieve the N most recent chunks for a contact (or globally) for RAG retrieval. */
export async function getRelevantCallChunks(opts: {
  contactId?: number;
  limit?: number;
}): Promise<Array<{ topic: string; summary: string; content: string; called_at: string | null; call_id: string }>> {
  const limit = opts.limit ?? 5;
  if (opts.contactId) {
    return query(
      `SELECT topic, summary, content, called_at, call_id
       FROM call_transcript_chunks
       WHERE contact_id = $1
       ORDER BY called_at DESC NULLS LAST
       LIMIT $2`,
      [opts.contactId, limit],
    );
  }
  return query(
    `SELECT topic, summary, content, called_at, call_id
     FROM call_transcript_chunks
     ORDER BY called_at DESC NULLS LAST
     LIMIT $1`,
    [limit],
  );
}
