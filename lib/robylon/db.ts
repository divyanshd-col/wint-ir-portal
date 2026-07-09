import { query } from '@/lib/cx/db';
import { PASCAL_TO_DB } from '@/lib/param-keys';

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

export interface LatestConversationRow {
  chatId: string;
  closedAt: string | null;
  tags: any;
  agentId: number | null;
  agentName: string | null;
}

export interface ConversationHistoryItem {
  chatId: string;
  date: string | null;
  conversationType: string | null;
  csat_score: number | null;
  tags: any;
  agentName: string | null;
  iqs: number | null;
  scoredAt: string | null;
}

export interface ScoredConversationRow {
  chatId: string;
  date: string | null;
  conversationType: string | null;
  frt: number | null;
  botToTeamSecs: number | null;
  resolutionTime: number | null;
  csat_score: number | null;
  csat_label: string | null;
  tags: any;
  disposition: string | null;
  subDisposition: string | null;
  agentName: string | null;
  iqs: number;
  parameters: Record<string, IQSParameterResult>;
  modelVersion: string;
  scoredAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ScoredCallRow {
  callId: string;
  chatId: string | null;
  calledAt: string | null;
  date: string | null;
  durationSeconds: number | null;
  language: string | null;
  interruptionCount: number;
  deadAirCount: number;
  agentName: string | null;
  iqs: number;
  parameters: Record<string, IQSParameterResult>;
  modelVersion: string;
  scoredAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
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

export async function getLatestConversationByPhone(phone: string): Promise<LatestConversationRow | null> {
  const rows = await query<LatestConversationRow>(`
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

export async function getConversationHistory(chatId: string, limit = 10): Promise<ConversationHistoryItem[]> {
  return query<ConversationHistoryItem>(`
    SELECT c.id AS "chatId", COALESCE(c.closed_at, c.started_at)::date AS "date",
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
    INSERT INTO iqs_scores (chat_id, iqs_score, parameters, model_version, scored_at, status)
    VALUES ($1, $2, $3, $4, NOW(), 'pending')
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
  minUserMessages?: number;
  chatIdSearch?: string;
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
  if (opts.conversationType) {
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

  return { conditions, params };
}

export async function getAllScoredConversations(
  opts: GetScoredConversationsOptions = {},
): Promise<{ rows: ScoredConversationRow[]; total: number }> {
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

  const rows = await query<ScoredConversationRow>(`
    SELECT
      c.id                        AS "chatId",
      COALESCE(c.closed_at, c.started_at)::date AS "date",
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
      COUNT(s.iqs_score)::int AS "iqsSampleSize"
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
    avgIqs: r.avgIqs != null ? Math.round(Number(r.avgIqs)) : null,
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
      COUNT(*) FILTER (WHERE s.iqs_score < 70)::int AS "atRisk",
      AVG(c.frt_seconds) AS "avgFrt",
      AVG(c.resolution_seconds) AS "avgResolution",
      AVG(c.bot_to_team_seconds) AS "avgBotToTeam",
      COUNT(*) FILTER (WHERE c.csat_score = 5)::int AS "csatGood",
      COUNT(*) FILTER (WHERE c.csat_score = 3)::int AS "csatCbb",
      COUNT(*) FILTER (WHERE c.csat_score = 1)::int AS "csatBad",
      COUNT(*) FILTER (WHERE c.csat_score IN (1, 3, 5))::int AS "csatTotal"
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
    GROUP BY COALESCE(a.name, 'Unknown')
    ORDER BY AVG(s.iqs_score) ASC
  `, params);

  return rows.map(r => {
    const csatTotal = r.csatTotal || 0;
    return {
      agent: r.agent,
      chats: r.chats,
      avgIqs: r.avgIqs != null ? Math.round(Number(r.avgIqs)) : 0,
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
}

export async function getScoredConversationsParamFails(opts: GetScoredConversationsOptions = {}): Promise<Record<string, number>> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<any>(`
    SELECT
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE (s.parameters->'opening'->>'score')::boolean = false)::int AS "opening",
      COUNT(*) FILTER (WHERE (s.parameters->'grammar'->>'score')::boolean = false)::int AS "grammar",
      COUNT(*) FILTER (WHERE (s.parameters->'sentences'->>'score')::boolean = false)::int AS "sentences",
      COUNT(*) FILTER (WHERE (s.parameters->'empathy'->>'score')::boolean = false)::int AS "empathy",
      COUNT(*) FILTER (WHERE (s.parameters->'all_questions'->>'score')::boolean = false)::int AS "all_questions",
      COUNT(*) FILTER (WHERE (s.parameters->'contextual'->>'score')::boolean = false)::int AS "contextual",
      COUNT(*) FILTER (WHERE (s.parameters->'technical'->>'score')::boolean = false)::int AS "technical",
      COUNT(*) FILTER (WHERE (s.parameters->'expectation'->>'score')::boolean = false)::int AS "expectation",
      COUNT(*) FILTER (WHERE (s.parameters->'follow_up'->>'score')::boolean = false)::int AS "follow_up",
      COUNT(*) FILTER (WHERE (s.parameters->'process'->>'score')::boolean = false)::int AS "process",
      COUNT(*) FILTER (WHERE (s.parameters->'tags'->>'score')::boolean = false)::int AS "tags",
      COUNT(*) FILTER (WHERE (s.parameters->'call'->>'score')::boolean = false)::int AS "call"
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    ${where}
  `, params);

  const r = rows[0] || {};
  const total = r.total || 0;
  const paramFails: Record<string, number> = {};

  if (total > 0) {
    const keys = ['opening', 'grammar', 'sentences', 'empathy', 'all_questions', 'contextual', 'technical', 'expectation', 'follow_up', 'process', 'tags', 'call'];
    for (const k of keys) {
      const dbVal = r[k] || 0;
      // Map DB snake_case key to legacy PascalCase
      const legacyKey = k === 'all_questions' ? 'AllQuestions'
                      : k === 'follow_up' ? 'FollowUp'
                      : k.charAt(0).toUpperCase() + k.slice(1);
      paramFails[legacyKey] = Math.round((dbVal / total) * 100);
    }
  }

  return paramFails;
}

export async function getScoredConversationsWeeklyParams(opts: GetScoredConversationsOptions = {}): Promise<any[]> {
  const { conditions, params } = buildFilters(opts);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<any>(`
    SELECT
      date_trunc('week', COALESCE(s.scored_at, c.closed_at) AT TIME ZONE 'UTC')::date::text AS "weekStart",
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE (s.parameters->'opening'->>'score')::boolean = false)::int AS "opening",
      COUNT(*) FILTER (WHERE (s.parameters->'grammar'->>'score')::boolean = false)::int AS "grammar",
      COUNT(*) FILTER (WHERE (s.parameters->'sentences'->>'score')::boolean = false)::int AS "sentences",
      COUNT(*) FILTER (WHERE (s.parameters->'empathy'->>'score')::boolean = false)::int AS "empathy",
      COUNT(*) FILTER (WHERE (s.parameters->'all_questions'->>'score')::boolean = false)::int AS "all_questions",
      COUNT(*) FILTER (WHERE (s.parameters->'contextual'->>'score')::boolean = false)::int AS "contextual",
      COUNT(*) FILTER (WHERE (s.parameters->'technical'->>'score')::boolean = false)::int AS "technical",
      COUNT(*) FILTER (WHERE (s.parameters->'expectation'->>'score')::boolean = false)::int AS "expectation",
      COUNT(*) FILTER (WHERE (s.parameters->'follow_up'->>'score')::boolean = false)::int AS "follow_up",
      COUNT(*) FILTER (WHERE (s.parameters->'process'->>'score')::boolean = false)::int AS "process",
      COUNT(*) FILTER (WHERE (s.parameters->'tags'->>'score')::boolean = false)::int AS "tags",
      COUNT(*) FILTER (WHERE (s.parameters->'call'->>'score')::boolean = false)::int AS "call"
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

    const keys = ['opening', 'grammar', 'sentences', 'empathy', 'all_questions', 'contextual', 'technical', 'expectation', 'follow_up', 'process', 'tags', 'call'];
    for (const k of keys) {
      const dbVal = row[k] || 0;
      const legacyKey = k === 'all_questions' ? 'AllQuestions'
                      : k === 'follow_up' ? 'FollowUp'
                      : k.charAt(0).toUpperCase() + k.slice(1);
      paramPercent[legacyKey] = total ? Math.round((dbVal / total) * 100) : 0;
    }

    return {
      key,
      label: getWeekLabel(key),
      total,
      params: paramPercent,
    };
  });
}

/** Get conversations ready to score (have transcript + tags but no iqs_scores row) */
export async function getUnscoredConversations(minHoursOld = 12, limit = 50, fromDate?: string): Promise<ConversationRow[]> {
  const params: any[] = [minHoursOld, limit];
  const fromClause = fromDate ? `AND c.closed_at >= $3::timestamptz` : '';
  if (fromDate) params.push(fromDate);

  return query<ConversationRow>(`
    SELECT c.*
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE s.chat_id IS NULL
      AND c.transcript IS NOT NULL
      AND jsonb_typeof(c.transcript) = 'array'
      AND jsonb_array_length(c.transcript) > 0
      AND c.tags IS NOT NULL
      AND (c.tags->>'disposition') IS NOT NULL
      AND (c.tags->>'disposition') != ''
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
  minScore?: number;
  maxScore?: number;
  unreviewedOnly?: boolean;
  dispositions?: string[];
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: ScoredCallRow[]; total: number }> {
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
  if (opts.unreviewedOnly) {
    conditions.push(`s.reviewed_at IS NULL`);
  }
  if (opts.dispositions?.length) {
    params.push(opts.dispositions);
    conditions.push(`r.call_disposition = ANY($${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countRows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM call_recordings r
    JOIN iqs_scores s ON s.chat_id = r.chat_id
    LEFT JOIN conversations conv ON conv.id = r.chat_id
    LEFT JOIN agents a ON a.id = COALESCE(conv.agent_id, r.agent_id)
    ${where}
  `, params);
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const page     = opts.page ?? 0;
  const pageSize = opts.pageSize ?? 50;
  const offsetVal = page * pageSize;
  params.push(pageSize, offsetVal);

  const rows = await query<ScoredCallRow>(`
    SELECT
      r.id                                    AS "callId",
      r.chat_id                               AS "chatId",
      r.called_at                             AS "calledAt",
      r.called_at::date                       AS "date",
      r.duration_seconds                      AS "durationSeconds",
      r.language,
      r.interruption_count                    AS "interruptionCount",
      r.dead_air_count                        AS "deadAirCount",
      NULLIF(COALESCE(a.name, ''), 'Robylon Automation') AS "agentName",
      s.call_iqs_score                        AS "iqs",
      s.call_parameters                       AS "parameters",
      s.call_model_version                    AS "modelVersion",
      s.call_scored_at                        AS "scoredAt",
      s.reviewed_by                           AS "reviewedBy",
      s.reviewed_at                           AS "reviewedAt",
      s.review_note                           AS "reviewNote"
    FROM call_recordings r
    JOIN iqs_scores s ON s.chat_id = r.chat_id
    LEFT JOIN conversations conv ON conv.id = r.chat_id
    LEFT JOIN agents a ON a.id = COALESCE(conv.agent_id, r.agent_id)
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
