import { query } from '@/lib/cx/db';
import { PASCAL_TO_DB, LEGACY_V4_FALLBACK_KEY } from '@/lib/param-keys';
import { PARAM_ORDER, calculateWeightedOverallIQS, extractPooledParams } from '@/lib/quality';

// Builds the per-parameter "fail count" SELECT columns for the v4 human rubric.
// Two correctness points vs the old hardcoded SQL:
//  1. Compare the score as TEXT (`->>'score' = 'false'`), never `::boolean` — v4
//     stores 0.5 for half-credit, and `'0.5'::boolean` raises a Postgres error that
//     500s the whole request.
//  2. v4 nests parameters under `__agent_parameters`; legacy v3 rows store them at
//     the top level; the 5 v4-only params may also sit under an old no-underscore
//     key. COALESCE covers all of those so old and new rows both count.
function buildParamFailColumns(): { columns: string; pairs: Array<{ db: string; pascal: string }> } {
  const pairs = PARAM_ORDER.map(pascal => ({ db: PASCAL_TO_DB[pascal] || pascal.toLowerCase(), pascal }));
  const columns = PARAM_ORDER.map(pascal => {
    const dbKey = PASCAL_TO_DB[pascal] || pascal.toLowerCase();
    const fb = LEGACY_V4_FALLBACK_KEY[pascal];
    const cell = fb
      ? `COALESCE(s.parameters->'__agent_parameters'->'${dbKey}', s.parameters->'${dbKey}', s.parameters->'__agent_parameters'->'${fb}', s.parameters->'${fb}')`
      : `COALESCE(s.parameters->'__agent_parameters'->'${dbKey}', s.parameters->'${dbKey}')`;
    return `COUNT(*) FILTER (WHERE ${cell}->>'score' = 'false')::int AS "${dbKey}"`;
  }).join(',\n      ');
  return { columns, pairs };
}

// ── Agent helpers ─────────────────────────────────────────────────────────────

/**
 * Merges any duplicate agent rows matching `name` (case-insensitive or prefix) into `primaryId`.
 * Reassigns conversations and call_recordings to `primaryId` and removes duplicate rows.
 */
export async function mergeAgentDuplicates(primaryId: number, name: string): Promise<void> {
  if (!primaryId || !name) return;
  const trimmed = name.trim();

  const duplicates = await query<{ id: number; tl_name: string | null; qa_name: string | null }>(
    `SELECT id, tl_name, qa_name FROM agents 
     WHERE id != $1 AND (
       LOWER(name) = LOWER($2) OR 
       LOWER(name) LIKE LOWER($2 || ' %') OR 
       LOWER($2) LIKE LOWER(name || ' %')
     )`,
    [primaryId, trimmed]
  );

  if (duplicates.length === 0) return;
  const dupIds = duplicates.map(d => d.id);

  const firstWithTL = duplicates.find(d => d.tl_name)?.tl_name;
  const firstWithQA = duplicates.find(d => d.qa_name)?.qa_name;
  if (firstWithTL || firstWithQA) {
    await query(
      `UPDATE agents 
       SET tl_name = COALESCE(tl_name, $2), qa_name = COALESCE(qa_name, $3) 
       WHERE id = $1`,
      [primaryId, firstWithTL ?? null, firstWithQA ?? null]
    );
  }

  await query(`UPDATE conversations SET agent_id = $1 WHERE agent_id = ANY($2)`, [primaryId, dupIds]);
  await query(`UPDATE call_recordings SET agent_id = $1 WHERE agent_id = ANY($2)`, [primaryId, dupIds]);
  await query(`DELETE FROM agents WHERE id = ANY($1)`, [dupIds]);
}

/** Get or create an agent by name. Returns agent.id */
export async function upsertAgent(name: string): Promise<number | null> {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // 1. Exact match
  const existing = await query<{ id: number }>(`SELECT id FROM agents WHERE name = $1`, [trimmed]);
  if (existing.length) {
    await mergeAgentDuplicates(existing[0].id, trimmed);
    return existing[0].id;
  }

  // 2. Case-insensitive or prefix match (e.g. 'Vedant' matching 'Vedant G', 'Aksa' matching 'Aksa Jacob')
  const fuzzy = await query<{ id: number }>(
    `SELECT id FROM agents WHERE LOWER(name) = LOWER($1) OR LOWER(name) LIKE LOWER($1 || ' %') OR LOWER($1) LIKE LOWER(name || ' %') LIMIT 1`,
    [trimmed],
  );
  if (fuzzy.length) {
    await mergeAgentDuplicates(fuzzy[0].id, trimmed);
    return fuzzy[0].id;
  }

  // 3. Fallback insert
  const rows = await query<{ id: number }>(
    `INSERT INTO agents (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [trimmed],
  );
  const newId = rows[0]?.id ?? null;
  if (newId) {
    await mergeAgentDuplicates(newId, trimmed);
  }
  return newId;
}

export async function getAgentName(agentId: number): Promise<string> {
  const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE id = $1`, [agentId]);
  return rows[0]?.name ?? '';
}

/** Returns the TL name (tl_name) for a given agent name. */
export async function getAgentTLByName(agentName: string): Promise<string | null> {
  if (!agentName?.trim()) return null;
  const trimmed = agentName.trim();
  try {
    const rows = await query<{ tl_name: string | null }>(
      `SELECT tl_name FROM agents WHERE LOWER(name) = LOWER($1) OR LOWER(name) LIKE LOWER($1 || ' %') OR LOWER($1) LIKE LOWER(name || ' %') LIMIT 1`,
      [trimmed]
    );
    return rows[0]?.tl_name || null;
  } catch (err) {
    console.error('[db] getAgentTLByName failed:', err);
    return null;
  }
}


/** Returns agent names whose tl_name matches (case-insensitive, handles email or user name). */
export async function getAgentNamesByTL(tlIdentifier: string): Promise<string[]> {
  if (!tlIdentifier) return [];
  const normalized = tlIdentifier.trim().toLowerCase();

  const { readConfig } = await import('@/lib/config');
  const config = await readConfig().catch(() => ({ users: [] }));
  const configUser = config.users?.find((u: any) =>
    (u.email || '').toLowerCase() === normalized ||
    (u.username || '').toLowerCase() === normalized ||
    (u.agentName || '').trim().toLowerCase() === normalized
  );

  let dbUserName = '';
  try {
    const userRows = await query<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE LOWER(email) = $1 OR LOWER(name) = $1 LIMIT 1`,
      [normalized]
    );
    if (userRows[0]?.name) dbUserName = userRows[0].name.toLowerCase();
  } catch {}

  const rawTokens = [
    normalized,
    normalized.includes('@') ? normalized.split('@')[0] : '',
    normalized.includes('@') ? normalized.split('@')[0].split('.')[0] : '',
    configUser?.email?.toLowerCase(),
    configUser?.email ? configUser.email.split('@')[0].toLowerCase() : '',
    configUser?.email ? configUser.email.split('@')[0].split('.')[0].toLowerCase() : '',
    configUser?.agentName?.trim().toLowerCase(),
    ...(configUser?.agentName ? configUser.agentName.trim().toLowerCase().split(/\s+/) : []),
    configUser?.username?.toLowerCase(),
    (configUser as any)?.name?.toLowerCase(),
    dbUserName,
    ...(dbUserName ? dbUserName.split(/\s+/) : []),
    ...(normalized.split(/\s+/)),
  ].filter(Boolean).map(s => s!.trim()).filter(s => s.length >= 3);

  const tokens = Array.from(new Set(rawTokens));

  const rows = await query<{ name: string }>(
    `SELECT a.name
     FROM agents a
     WHERE a.status = 'active'
       AND (
         LOWER(TRIM(a.tl_name)) = ANY($1::text[])
         OR EXISTS (
           SELECT 1 FROM unnest($1::text[]) t
           WHERE LOWER(a.tl_name) LIKE '%' || t || '%'
              OR t LIKE '%' || LOWER(TRIM(a.tl_name)) || '%'
         )
       )
     ORDER BY a.name ASC`,
    [tokens]
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
    SELECT c.id AS "chatId", COALESCE(c.closed_at, c.started_at)::date::text AS "date",
           c.conversation_type AS "conversationType", c.csat_score, c.tags,
           a.name AS "agentName", s.iqs_score AS "iqs", s.scored_at AS "scoredAt"
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.contact_id = (SELECT contact_id FROM conversations WHERE id = $1)
      AND c.id != $1 AND c.contact_id IS NOT NULL
    ORDER BY COALESCE(c.closed_at, c.started_at) DESC NULLS LAST
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
  score: boolean | number | null;  // true=Yes, false=No, null=NA, 0.5=Half
  reasoning: string;
  kbCitation?: string;
}

export async function insertIQSScore(data: {
  chatId: string;
  iqsScore?: number | null;
  parameters: Record<string, IQSParameterResult>;
  modelVersion: string;
  uncertainParameters?: Array<{ parameter: string; question: string }>;
  
  // Optional bot metrics for hybrid / bot chats
  botIqsScore?: number | null;
  botParameters?: Record<string, IQSParameterResult>;
  botModelVersion?: string;
  
  // Additional v4 metadata
  breaches?: string[];
  answerChanges?: string[];
  unrelatedCallFlag?: boolean;
}): Promise<void> {
  const stored: Record<string, any> = {};
  if (data.parameters && Object.keys(data.parameters).length > 0) {
    stored.__agent_parameters = { ...data.parameters };
  }
  if (data.uncertainParameters && data.uncertainParameters.length > 0) {
    stored.__uncertain = data.uncertainParameters;
  }
  if (data.breaches) stored.__breaches = data.breaches;
  if (data.answerChanges) stored.__answerChanges = data.answerChanges;
  if (data.unrelatedCallFlag) stored.__unrelatedCallFlag = data.unrelatedCallFlag;

  if (data.botIqsScore !== undefined || data.iqsScore !== undefined) {
    stored.__scores = {
      agent_iqs: data.iqsScore ?? null,
      bot_iqs: data.botIqsScore ?? null,
    };
  }
  if (data.botParameters) stored.__bot_parameters = data.botParameters;
  if (data.botModelVersion) stored.__bot_model_version = data.botModelVersion;

  const isBotOnlyMode = Boolean(data.botParameters && (!data.parameters || Object.keys(data.parameters).length === 0));
  const primaryScore = data.iqsScore ?? (isBotOnlyMode ? data.botIqsScore : null) ?? null;

  await query(`
    INSERT INTO iqs_scores (
      chat_id, iqs_score, parameters, model_version, scored_at, status
    )
    VALUES ($1, $2, $3, $4, NOW(), 'pending')
    ON CONFLICT (chat_id) DO UPDATE SET
      iqs_score         = EXCLUDED.iqs_score,
      parameters        = EXCLUDED.parameters,
      model_version     = EXCLUDED.model_version,
      scored_at         = NOW(),
      status            = 'pending'
  `, [
    data.chatId, 
    primaryScore, 
    JSON.stringify(stored), 
    data.modelVersion
  ]);
}

/** Update CSAT on conversations table — called from CSAT_SUBMITTED */
export async function updateIQSCsat(chatId: string, csatScore: number, csatLabel: string): Promise<boolean> {
  await updateConversationCsat(chatId, csatScore, csatLabel);
  return true;
}

// ── Fetch all scored conversations (for quality dashboard) ────────────────────

export interface GetScoredConversationsOptions {
  page?: number;
  pageSize?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  agentName?: string;
  agentNames?: string[];
  iqsMin?: number;
  iqsMax?: number;
  includeUncertain?: boolean;
  disposition?: string;
  subDisposition?: string;
  dispositions?: string[];
  csat?: string;
  conversationType?: string;
  hasCalls?: boolean;
  minUserMessages?: number;
  chatIdSearch?: string;
  excludeNil?: boolean;
}

function buildFilters(opts: GetScoredConversationsOptions = {}): { conditions: string[]; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    conditions.push(`c.closed_at::date >= $${params.length}`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    conditions.push(`c.closed_at::date <= $${params.length}`);
  }
  if (opts.iqsMin !== undefined && opts.iqsMin > 0) {
    params.push(opts.iqsMin);
    conditions.push(`s.iqs_score >= $${params.length}`);
  }
  if (opts.iqsMax !== undefined) {
    params.push(opts.iqsMax);
    if (opts.includeUncertain) {
      conditions.push(`(s.iqs_score <= $${params.length} OR s.parameters ? '__uncertain' OR (s.iqs_score IS NULL AND (c.csat_score = 1 OR c.csat_label = 'bad')))`);
    } else {
      conditions.push(`(s.iqs_score <= $${params.length} OR (s.iqs_score IS NULL AND (c.csat_score = 1 OR c.csat_label = 'bad')))`);
    }
  } else if (opts.includeUncertain) {
    conditions.push(`s.parameters ? '__uncertain'`);
  }
  if (opts.agentName) {
    params.push(opts.agentName);
    conditions.push(`(a.name = $${params.length} OR a.name ILIKE $${params.length} || ' %')`);
  } else if (opts.agentNames && opts.agentNames.length > 0) {
    params.push(opts.agentNames);
    conditions.push(`(a.name = ANY($${params.length}) OR EXISTS (
      SELECT 1 FROM unnest($${params.length}::text[]) elem
      WHERE a.name = elem OR a.name ILIKE elem || ' %'
    ))`);
  } else if (opts.agentNames && opts.agentNames.length === 0) {
    conditions.push(`1=0`);
  }
  if (opts.disposition) {
    params.push(opts.disposition);
    conditions.push(`(c.tags->>'disposition') = $${params.length}`);
  } else if (opts.dispositions && opts.dispositions.length > 0) {
    params.push(opts.dispositions);
    conditions.push(`(c.tags->>'disposition') = ANY($${params.length})`);
  }
  if (opts.subDisposition) {
    params.push(opts.subDisposition);
    conditions.push(`(c.tags->>'sub_disposition') = $${params.length}`);
  }
  if (opts.csat) {
    params.push(parseInt(opts.csat, 10));
    conditions.push(`c.csat_score = $${params.length}`);
  }
  if (opts.conversationType === 'has_calls' || opts.hasCalls) {
    conditions.push(`EXISTS (
      SELECT 1 FROM call_recordings cr
      WHERE cr.chat_id = c.id
         OR (
           c.contact_id IS NOT NULL 
           AND cr.contact_id = c.contact_id 
           AND cr.called_at IS NOT NULL
           AND (c.started_at IS NULL OR cr.called_at >= c.started_at)
           AND (c.closed_at IS NULL OR cr.called_at <= c.closed_at)
         )
    )`);
  } else if (opts.conversationType === 'human_only') {
    conditions.push(`(a.name IS NULL OR a.name != 'Robylon AI') AND (c.agent_id IS NULL OR c.agent_id NOT IN (15, 447, 784))`);
  } else if (opts.conversationType === 'bot_only') {
    conditions.push(`(a.name = 'Robylon AI' OR c.agent_id IN (15, 447, 784))`);
  } else if (opts.conversationType && opts.conversationType !== 'all') {
    params.push(opts.conversationType);
    conditions.push(`c.conversation_type = $${params.length}`);
  }
  if (opts.minUserMessages !== undefined && opts.minUserMessages > 0) {
    params.push(opts.minUserMessages);
    conditions.push(`(c.raw_payload->'counts'->>'user_message_count')::int >= $${params.length}`);
  }
  if (opts.chatIdSearch) {
    params.push(`%${opts.chatIdSearch.trim()}%`);
    conditions.push(`c.id LIKE $${params.length}`);
  }
  if (opts.excludeNil) {
    conditions.push(`s.iqs_score IS NOT NULL`);
  }

  return { conditions, params };
}

export async function getAllScoredConversations(
  opts: GetScoredConversationsOptions = {},
): Promise<{ rows: any[]; total: number }> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
  `, params);
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  let limitSql = '';
  if (opts.limit !== undefined && opts.limit > 0) {
    limitSql = `LIMIT ${opts.limit}`;
  } else if (opts.page !== undefined || opts.pageSize !== undefined) {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 50;
    const offsetVal = page * pageSize;
    params.push(pageSize, offsetVal);
    limitSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }

  const rows = await query(`
    SELECT
      c.id                        AS "chatId",
      COALESCE(c.closed_at, c.started_at)::date::text AS "date",
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
    ORDER BY c.closed_at DESC NULLS LAST, s.scored_at DESC
    ${limitSql}
  `, params);

  return { rows, total };
}

export async function getScoredConversationsFilterOptions(
  opts: GetScoredConversationsOptions = {},
): Promise<{
  availableAgents: string[];
  availableDispositions: string[];
  availableSubDispositions: string[];
  dispositionSubMap: Record<string, string[]>;
}> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<{
    agentName: string | null;
    disposition: string | null;
    subDisposition: string | null;
  }>(`
    SELECT DISTINCT
      a.name AS "agentName",
      c.tags->>'disposition' AS "disposition",
      c.tags->>'sub_disposition' AS "subDisposition"
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
  `, params);

  const availableAgents = [...new Set(rows.map(r => r.agentName).filter(Boolean))].sort() as string[];
  const availableDispositions = [...new Set(rows.map(r => r.disposition).filter(Boolean))].sort() as string[];
  const availableSubDispositions = [...new Set(rows.map(r => r.subDisposition).filter(Boolean))].sort() as string[];

  const dispositionSubMap: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.disposition) continue;
    if (!dispositionSubMap[r.disposition]) {
      dispositionSubMap[r.disposition] = [];
    }
    if (r.subDisposition && !dispositionSubMap[r.disposition].includes(r.subDisposition)) {
      dispositionSubMap[r.disposition].push(r.subDisposition);
    }
  }
  for (const k of Object.keys(dispositionSubMap)) {
    dispositionSubMap[k].sort();
  }

  return {
    availableAgents,
    availableDispositions,
    availableSubDispositions,
    dispositionSubMap,
  };
}

export async function getScoredConversationsSummary(opts: GetScoredConversationsOptions = {}): Promise<any> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<any>(`
    SELECT
      COUNT(*)::int AS "totalConvos",
      COUNT(*) FILTER (WHERE c.conversation_type = 'bot')::int AS "botConvos",
      COUNT(*) FILTER (WHERE c.conversation_type != 'bot')::int AS "agentConvos",
      AVG(CASE WHEN c.csat_score = 5 THEN 100 WHEN c.csat_score = 3 THEN 50 WHEN c.csat_score = 1 THEN 0 ELSE NULL END) AS "overallCsat",
      AVG(CASE WHEN c.csat_score = 5 THEN 100 WHEN c.csat_score = 3 THEN 50 WHEN c.csat_score = 1 THEN 0 ELSE NULL END) FILTER (WHERE c.conversation_type = 'bot') AS "botCsat",
      AVG(CASE WHEN c.csat_score = 5 THEN 100 WHEN c.csat_score = 3 THEN 50 WHEN c.csat_score = 1 THEN 0 ELSE NULL END) FILTER (WHERE c.conversation_type != 'bot') AS "agentCsat",
      COUNT(*) FILTER (WHERE c.csat_score = 5)::int AS "good",
      COUNT(*) FILTER (WHERE c.csat_score IN (1, 3))::int AS "cbbBad",
      COUNT(*) FILTER (WHERE c.csat_score IN (1, 3, 5))::int AS "withC",
      AVG(c.frt_seconds) AS "avgFrt",
      AVG(c.bot_to_team_seconds) AS "avgBotToTeam",
      COUNT(*) FILTER (WHERE c.bot_to_team_seconds <= 180)::int AS "slaOk",
      COUNT(c.bot_to_team_seconds)::int AS "slaTotal",
      AVG(c.resolution_seconds) AS "avgResolution",
      AVG(s.iqs_score) AS "avgIqs",
      COUNT(s.iqs_score)::int AS "iqsSampleSize",
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
  `, params);

  const r = rows[0] || {};
  const totalFiltered = r.totalConvos || 0;
  const withC = r.withC || 0;
  const slaTotal = r.slaTotal || 0;
  const slaOk = r.slaOk || 0;
  const iqsSampleSize = r.iqsSampleSize || 0;

  const pooled = extractPooledParams(r.parameters);
  const weightedIqs = calculateWeightedOverallIQS(pooled, 'human');
  const avgIqs: number | null = weightedIqs ?? (r.avgIqs != null ? Math.round(Number(r.avgIqs)) : null);

  return {
    totalConvos: totalFiltered,
    botConvos: r.botConvos || 0,
    agentConvos: r.agentConvos || 0,
    overallCsat: r.overallCsat != null ? Math.round(Number(r.overallCsat)) : null,
    botCsat: r.botCsat != null ? Math.round(Number(r.botCsat)) : null,
    agentCsat: r.agentCsat != null ? Math.round(Number(r.agentCsat)) : null,
    good: r.good || 0,
    cbbBad: r.cbbBad || 0,
    cbbBadPct: withC > 0 ? Math.round((r.cbbBad / withC) * 100) : 0,
    avgFrt: r.avgFrt != null ? Math.round(Number(r.avgFrt)) : null,
    avgBotToTeam: r.avgBotToTeam != null ? Math.round(Number(r.avgBotToTeam)) : null,
    slaPercent: slaTotal > 0 ? Math.round((slaOk / slaTotal) * 100) : null,
    slaThresholdSecs: 180,
    avgResolution: r.avgResolution != null ? Math.round(Number(r.avgResolution)) : null,
    avgClosure: null,
    avgIqs: avgIqs,
    iqsSampleSize,
    samplingPct: totalFiltered > 0 ? Math.round((iqsSampleSize / totalFiltered) * 100) : 0,
  };
}

export async function getScoredConversationsAgentStats(opts: GetScoredConversationsOptions = {}): Promise<any[]> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<any>(`
    SELECT
      COALESCE(a.name, 'Unknown') AS "agent",
      COUNT(*)::int AS "chats",
      AVG(s.iqs_score) AS "avgIqs",
      MIN(s.iqs_score)::int AS "minIqs",
      MAX(s.iqs_score)::int AS "maxIqs",
      COUNT(*) FILTER (WHERE s.iqs_score >= 90)::int AS "high",
      COUNT(*) FILTER (WHERE s.iqs_score IS NOT NULL AND s.iqs_score < 70)::int AS "atRisk",
      AVG(c.frt_seconds) AS "avgFrt",
      AVG(c.resolution_seconds) AS "avgResolution",
      AVG(c.bot_to_team_seconds) AS "avgBotToTeam",
      COUNT(*) FILTER (WHERE c.csat_score = 5)::int AS "csatGood",
      COUNT(*) FILTER (WHERE c.csat_score = 3)::int AS "csatCbb",
      COUNT(*) FILTER (WHERE c.csat_score = 1)::int AS "csatBad",
      COUNT(*) FILTER (WHERE c.csat_score IN (1, 3, 5))::int AS "csatTotal",
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
    GROUP BY COALESCE(a.name, 'Unknown')
  `, params);

  const stats = rows.map(r => {
    const csatTotal = r.csatTotal || 0;
    const pooled = extractPooledParams(r.parameters);
    const weightedIqs = calculateWeightedOverallIQS(pooled, 'human');
    const avgIqs = weightedIqs ?? (r.avgIqs != null ? Math.round(Number(r.avgIqs)) : 0);

    return {
      agent: r.agent,
      chats: r.chats,
      avgIqs,
      minIqs: r.minIqs ?? 0,
      maxIqs: r.maxIqs ?? 0,
      high: r.high,
      atRisk: r.atRisk,
      avgFrt: r.avgFrt != null ? Math.round(Number(r.avgFrt)) : null,
      avgResolution: r.avgResolution != null ? Math.round(Number(r.avgResolution)) : null,
      avgClosure: null,
      avgBotToTeam: r.avgBotToTeam != null ? Math.round(Number(r.avgBotToTeam)) : null,
      csatGood: r.csatGood,
      csatCbb: r.csatCbb,
      csatBad: r.csatBad,
      csatPct: csatTotal > 0 ? Math.round((r.csatGood / csatTotal) * 100) : null,
    };
  });

  return stats.sort((a, b) => a.avgIqs - b.avgIqs);
}

export async function getScoredConversationsParamFails(opts: GetScoredConversationsOptions = {}): Promise<Record<string, number>> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { columns, pairs } = buildParamFailColumns();
  const rows = await query<any>(`
    SELECT
      COUNT(*)::int AS "total",
      ${columns}
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
  `, params);

  const r = rows[0] || {};
  const total = r.total || 0;
  const paramFails: Record<string, number> = {};

  if (total > 0) {
    for (const { db, pascal } of pairs) {
      paramFails[pascal] = Math.round(((r[db] || 0) / total) * 100);
    }
  }

  return paramFails;
}

export async function getScoredConversationsWeeklyParams(opts: GetScoredConversationsOptions = {}): Promise<any[]> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { columns, pairs } = buildParamFailColumns();
  const rows = await query<any>(`
    SELECT
      date_trunc('week', COALESCE(s.scored_at, c.closed_at) AT TIME ZONE 'UTC')::date::text AS "weekStart",
      COUNT(*)::int AS "total",
      ${columns}
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
    GROUP BY date_trunc('week', COALESCE(s.scored_at, c.closed_at) AT TIME ZONE 'UTC')::date
    ORDER BY "weekStart" DESC
  `, params);

  const { getWeekLabel } = await import('@/lib/stats');

  return rows.map(row => {
    const key = row.weekStart;
    const total = row.total || 0;
    const paramPercent: Record<string, number> = {};

    for (const { db, pascal } of pairs) {
      paramPercent[pascal] = total ? Math.round(((row[db] || 0) / total) * 100) : 0;
    }

    return {
      key,
      label: getWeekLabel(key),
      total,
      params: paramPercent,
    };
  });
}

/** Get conversations ready to score (have transcript but no iqs_scores row or text leg unscored) */
export async function getUnscoredConversations(minHoursOld = 12, limit = 50, fromDate?: string): Promise<ConversationRow[]> {
  const params: any[] = [minHoursOld, limit];
  const fromClause = fromDate ? `AND c.closed_at >= $3::timestamptz` : '';
  if (fromDate) params.push(fromDate);

  return query<ConversationRow>(`
    SELECT c.*
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE (s.chat_id IS NULL OR (s.iqs_score IS NULL AND s.status = 'skipped'))
      AND c.transcript IS NOT NULL
      AND (
        (jsonb_typeof(c.transcript) = 'array' AND jsonb_array_length(c.transcript) > 0)
        OR (jsonb_typeof(c.transcript->'messages') = 'array' AND jsonb_array_length(c.transcript->'messages') > 0)
      )
      AND c.closed_at < NOW() - ($1 * INTERVAL '1 hour')
      ${fromClause}
    ORDER BY c.closed_at ASC
    LIMIT $2
  `, params);
}

/**
 * Insert a sentinel iqs_scores row for chats that can never be scored (e.g.
 * call-interaction chats, chats with no readable transcript). This prevents
 * getUnscoredConversations from picking them up on every subsequent batch.
 * iqs_score is left NULL — callers that aggregate scores already handle NULLs.
 */
export async function markChatUnscoreable(chatId: string, reason: string): Promise<void> {
  await query(`
    INSERT INTO iqs_scores (chat_id, model_version, scored_at, status)
    VALUES ($1, $2, NOW(), 'skipped')
    ON CONFLICT (chat_id) DO NOTHING
  `, [chatId, `skipped:${reason.slice(0, 80)}`]);
}

export async function countUnscoredConversations(minHoursOld = 0): Promise<number> {
  const rows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE (s.chat_id IS NULL OR (s.iqs_score IS NULL AND s.status = 'skipped'))
      AND c.transcript IS NOT NULL
      AND (
        (jsonb_typeof(c.transcript) = 'array' AND jsonb_array_length(c.transcript) > 0)
        OR (jsonb_typeof(c.transcript->'messages') = 'array' AND jsonb_array_length(c.transcript->'messages') > 0)
      )
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
    INSERT INTO iqs_scores (chat_id, call_iqs_score, call_parameters, call_model_version, call_scored_at, status)
    VALUES ($4, $1, $2, $3, NOW(), 'skipped')
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
    JOIN conversations target_conv ON target_conv.id::text = $1
    JOIN conversations conv_call ON conv_call.id::text = cr.chat_id
    WHERE conv_call.contact_id IS NOT NULL
      AND conv_call.contact_id = target_conv.contact_id
      AND cr.chat_id != $1
      AND cr.called_at >= target_conv.started_at
      AND cr.called_at <= COALESCE(target_conv.closed_at, NOW())
    ORDER BY cr.called_at ASC NULLS LAST, cr.created_at ASC
  `, [chatId]);
}

/**
 * Find all call recordings for a contact within a chat's exact started_at to closed_at timeframe.
 * Fallback when call_recordings.chat_id is NULL or not linked to any conversation row.
 */
export async function getCallRecordingsByContactWindow(
  contactId: number,
  windowStart: string,
  windowEnd: string,
): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(`
    SELECT * FROM call_recordings
    WHERE contact_id = $1
      AND called_at >= $2::timestamptz
      AND called_at <= $3::timestamptz
    ORDER BY called_at ASC
  `, [contactId, windowStart, windowEnd]);
}

/** Find call recordings for a contact that have not yet been linked to a chat.
 *  Requires call to be initiated strictly between startedAt and closedAt. */
export async function getUnlinkedCallsForContact(
  contactId: number,
  startedAt: string,
  closedAt: string,
): Promise<CallRecordingRow[]> {
  return query<CallRecordingRow>(`
    SELECT * FROM call_recordings
    WHERE contact_id = $1
      AND chat_id IS NULL
      AND called_at >= $2::timestamptz
      AND called_at <= $3::timestamptz
    ORDER BY called_at ASC
  `, [contactId, startedAt, closedAt]);
}

/** Find the closed conversation that a call belongs to, for self-linking after late transcription.
 *  Matches a conversation whose exact window (started_at → closed_at) contains the call. */
export async function findClosedConversationForCall(
  contactId: number,
  calledAt: string,
): Promise<{ id: string } | null> {
  const rows = await query<{ id: string }>(`
    SELECT id FROM conversations
    WHERE contact_id = $1
      AND started_at <= $2::timestamptz
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
  // Propagate the conversation's IR to the call recording when the call has no agent set.
  // Fixes "Robylon Automation" appearing as agent name in the Call Queue.
  await query(
    `UPDATE call_recordings cr
     SET agent_id = conv.agent_id, updated_at = NOW()
     FROM conversations conv
     WHERE conv.id = $1
       AND cr.id = $2
       AND cr.agent_id IS NULL
       AND conv.agent_id IS NOT NULL`,
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
  callId?: string;
  minScore?: number;
  maxScore?: number;
  unreviewedOnly?: boolean;
  dispositions?: string[];
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: any[]; total: number }> {
  // Join call_recordings → call_evaluations (via call_id) or iqs_scores (via chat_id)
  const conditions: string[] = ['(ce.iqs_percent IS NOT NULL OR s.call_iqs_score IS NOT NULL)'];
  const params: any[] = [];

  if (opts.callId) {
    params.push(`%${opts.callId.trim()}%`);
    conditions.push(`r.id ILIKE $${params.length}`);
  }

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
    conditions.push(`COALESCE(ce.iqs_percent, s.call_iqs_score) >= $${params.length}`);
  }
  if (opts.maxScore !== undefined) {
    params.push(opts.maxScore);
    conditions.push(`COALESCE(ce.iqs_percent, s.call_iqs_score) <= $${params.length}`);
  }
  if (opts.agentName) {
    params.push(opts.agentName);
    conditions.push(`(COALESCE(a.name, '') = $${params.length} OR a.name ILIKE $${params.length} || ' %')`);
  } else if (opts.agentNames && opts.agentNames.length > 0) {
    params.push(opts.agentNames);
    conditions.push(`(COALESCE(a.name, '') = ANY($${params.length}) OR EXISTS (
      SELECT 1 FROM unnest($${params.length}::text[]) elem
      WHERE a.name = elem OR a.name ILIKE elem || ' %'
    ))`);
  } else if (opts.agentNames && opts.agentNames.length === 0) {
    conditions.push('1=0');
  }
  if (opts.unreviewedOnly) {
    conditions.push(`COALESCE(ce.reviewed_at, s.reviewed_at) IS NULL`);
  }
  if (opts.dispositions?.length) {
    params.push(opts.dispositions);
    conditions.push(`r.call_disposition = ANY($${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countRows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM call_recordings r
    LEFT JOIN call_evaluations ce ON ce.call_id = r.id
    LEFT JOIN iqs_scores s ON s.chat_id = r.chat_id
    LEFT JOIN conversations conv ON conv.id = r.chat_id
    LEFT JOIN agents a ON a.id = COALESCE(ce.agent_id, conv.agent_id, r.agent_id)
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
      COALESCE(ce.chat_id, r.chat_id)         AS "chatId",
      r.called_at                             AS "calledAt",
      r.called_at::date                       AS "date",
      r.duration_seconds                      AS "durationSeconds",
      r.language,
      r.interruption_count                    AS "interruptionCount",
      r.dead_air_count                        AS "deadAirCount",
      r.call_disposition                     AS "disposition",
      r.call_sub_disposition                 AS "subDisposition",
      NULLIF(COALESCE(a.name, ''), 'Robylon Automation') AS "agentName",
      COALESCE(ce.iqs_percent, s.call_iqs_score) AS "iqs",
      COALESCE(ce.iqs_scores, s.call_parameters) AS "parameters",
      ce.verdict                              AS "verdict",
      ce.gates                                AS "gates",
      s.call_model_version                    AS "modelVersion",
      COALESCE(ce.scored_at, s.call_scored_at) AS "scoredAt",
      COALESCE(ce.reviewed_by, s.reviewed_by) AS "reviewedBy",
      COALESCE(ce.reviewed_at, s.reviewed_at) AS "reviewedAt",
      COALESCE(ce.review_note, s.review_note) AS "reviewNote"
    FROM call_recordings r
    LEFT JOIN call_evaluations ce ON ce.call_id = r.id
    LEFT JOIN iqs_scores s ON s.chat_id = r.chat_id
    LEFT JOIN conversations conv ON conv.id = r.chat_id
    LEFT JOIN agents a ON a.id = COALESCE(ce.agent_id, conv.agent_id, r.agent_id)
    ${where}
    ORDER BY r.called_at DESC NULLS LAST, COALESCE(ce.scored_at, s.call_scored_at) DESC NULLS LAST
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
  if (!chunks.length) return;
  const values: string[] = [];
  const params: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const offset = i * 9;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`);
    params.push(
      c.callId,
      c.chatId ?? null,
      c.contactId ?? null,
      c.agentId ?? null,
      c.calledAt ?? null,
      c.topic,
      c.summary,
      c.content,
      c.chunkIndex
    );
  }
  await query(
    `INSERT INTO call_transcript_chunks
       (call_id, chat_id, contact_id, agent_id, called_at, topic, summary, content, chunk_index)
     VALUES ${values.join(', ')}`,
    params
  );
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
