/**
 * Persistent storage via Upstash Redis REST API.
 * Falls back to no-op if env vars not set (local dev uses file only).
 */

import type { PortalConfig } from './config';
import type { KnowledgeChunk, SavedConversation } from './types';
import { log } from '@/lib/log';
import { query } from '@/lib/cx/db';

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const CONFIG_KEY = 'wint_portal_config';
const LOGS_KEY = 'wint_portal_logs';
const KB_CACHE_KEY = 'wint_kb_cache_v2'; // v2: 600-char chunks with overlap

function ready(): boolean {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

async function kv_get(key: string): Promise<string | null> {
  if (!ready()) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: 'no-store',
    });
    const data = await res.json();
    return data.result ?? null;
  } catch {
    return null;
  }
}

async function kv_pipeline(commands: any[][]): Promise<any> {
  if (!ready()) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) {
      throw new Error(`Upstash pipeline HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  } catch (e: any) {
    log.warn('store', 'kv pipeline error', { err: e?.message ?? String(e) });
    throw e;
  }
}

async function kv_set(key: string, value: string): Promise<void> {
  try {
    await kv_pipeline([['SET', key, value]]);
  } catch {}
}

async function kv_lpush(key: string, value: string): Promise<void> {
  try {
    await kv_pipeline([['LPUSH', key, value], ['LTRIM', key, '0', '499']]);
  } catch {}
}

async function kv_lrange(key: string, start: number, end: number): Promise<string[]> {
  if (!ready()) return [];
  try {
    const res = await fetch(`${UPSTASH_URL}/lrange/${key}/${start}/${end}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: 'no-store',
    });
    const data = await res.json();
    return Array.isArray(data.result) ? data.result : [];
  } catch {
    return [];
  }
}

// --- Chat scoring lock (SET NX) ---
// Prevents concurrent duplicate scoring of the same chat when Robylon fires
// multiple CLASSIFICATION_UPDATED events before the first LLM call completes.

export async function storeAcquireScoringLock(chatId: string): Promise<boolean> {
  if (!ready()) return true; // allow if KV not configured
  try {
    const data = await kv_pipeline([['SET', `wint_scoring_lock:${chatId}`, '1', 'EX', '1800', 'NX']]);
    const result = Array.isArray(data) ? data[0]?.result : data?.result;
    return result === 'OK';
  } catch {
    console.warn(`[store] Scoring lock KV error for chat ${chatId} — denying lock`);
    return false;
  }
}

/** Release a scoring lock manually — used by admin batch scoring so that
 *  a lock held from a previous failed attempt doesn't block the next batch. */
export async function storeDeleteScoringLock(chatId: string): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/del/wint_scoring_lock:${chatId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
  } catch {
    // Non-critical — if DEL fails the lock will simply expire after 30 min
  }
}

// --- Webhook event_id deduplication ---
// Prevents the same Robylon webhook event from being processed twice
// (Robylon retries on timeout — both can arrive before scoring completes).

export async function storeHasProcessedEvent(eventId: string): Promise<boolean> {
  const val = await kv_get(`wint_webhook_event:${eventId}`);
  return val === '1';
}

export async function storeMarkProcessedEvent(eventId: string): Promise<void> {
  try {
    await kv_pipeline([['SET', `wint_webhook_event:${eventId}`, '1', 'EX', '7200']]);
  } catch {}
}

// --- Quality Slack alert deduplication ---
// Prevents the same chat from firing a Slack alert more than once
// (can happen when webhook + manual scoring both run on the same chat).

export async function storeHasQualityAlert(chatId: string): Promise<boolean> {
  const val = await kv_get(`wint_quality_alerted:${chatId}`);
  return val === '1';
}

export async function storeMarkQualityAlert(chatId: string): Promise<void> {
  try {
    await kv_pipeline([['SET', `wint_quality_alerted:${chatId}`, '1', 'EX', '86400']]);
  } catch {}
}

export async function storeHasBotQualityAlert(chatId: string): Promise<boolean> {
  const val = await kv_get(`wint_bot_quality_alerted:${chatId}`);
  return val === '1';
}

export async function storeMarkBotQualityAlert(chatId: string): Promise<void> {
  try {
    await kv_pipeline([['SET', `wint_bot_quality_alerted:${chatId}`, '1', 'EX', '86400']]);
  } catch {}
}

// --- Config ---

export async function storeGetConfig(): Promise<PortalConfig | null> {
  const raw = await kv_get(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function storeSetConfig(config: PortalConfig): Promise<void> {
  await kv_set(CONFIG_KEY, JSON.stringify(config));
}

// --- Logs ---

export async function storeAppendLog(entry: object): Promise<void> {
  await kv_lpush(LOGS_KEY, JSON.stringify(entry));
}

export async function storeGetLogs(): Promise<string[]> {
  return kv_lrange(LOGS_KEY, 0, 499);
}

// --- KB Cache ---

export async function storeGetKBCache(): Promise<KnowledgeChunk[] | null> {
  const raw = await kv_get(KB_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function storeSetKBCache(chunks: KnowledgeChunk[]): Promise<void> {
  await kv_set(KB_CACHE_KEY, JSON.stringify(chunks));
}

export async function storeClearKBCache(): Promise<void> {
  await kv_set(KB_CACHE_KEY, 'null');
}

// --- Corrections ---

const CORRECTIONS_KEY = 'wint_corrections';

export async function storeAppendCorrection(entry: object): Promise<void> {
  try {
    await kv_pipeline([['LPUSH', CORRECTIONS_KEY, JSON.stringify(entry)], ['LTRIM', CORRECTIONS_KEY, '0', '199']]);
  } catch {}
}

export async function storeGetCorrections(): Promise<string[]> {
  return kv_lrange(CORRECTIONS_KEY, 0, -1);
}

export async function storeSetCorrections(entries: object[]): Promise<void> {
  await kv_set(CORRECTIONS_KEY, JSON.stringify(entries));
}

// --- IQS Quality Scores are stored in PostgreSQL iqs_scores table ---

// --- IQS Score Flags (agent disputes a score, sent to quality for review) ---

const IQS_FLAGS_KEY = 'wint_iqs_flags';

export interface IQSChallengedParam {
  param: string;   // e.g. "Opening"
  note: string;    // agent's specific note for this param
}

export interface IQSFlag {
  id: string;
  scoreId?: string;
  chatId: string;
  callId?: string;
  agentName: string;
  agentEmail: string;
  agentNote: string;
  challengedParams?: IQSChallengedParam[];
  flaggedAt: string;           // ISO
  updatedAt?: string;          // ISO — last state transition
  /** who created this flag */
  raisedByRole: 'ir' | 'tl';
  /**
   * Historical: 'cat1'/'cat2' routed a dispute through the old CAT1/CAT2 TL
   * ownership split (retired). New flags always use 'qa' — every dispute now
   * follows the same single Agent → TL → QA path regardless of which
   * parameter was challenged. Kept non-optional — iqs_flags.param_category
   * is NOT NULL in Postgres.
   */
  paramCategory: 'cat1' | 'cat2' | 'qa';
  /** links sibling flags created from the same mixed IR dispute (historical only) */
  parentFlagId?: string;
  /**
   * 'ir_pending_tl' / 'pending' — awaiting TL review.
   * 'tl_forwarded'             — TL forwarded it on to QA for a final decision.
   * 'tl_resolved'              — historical only; TL no longer resolves disputes.
   * 'reviewed'                 — QA has made the final decision.
   * 'cancelled'                — agent withdrew it while still awaiting TL.
   */
  status: 'ir_pending_tl' | 'pending' | 'tl_forwarded' | 'tl_resolved' | 'reviewed' | 'cancelled';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface IQSFlagComment {
  id: string;
  flagId: string;
  authorEmail: string;
  authorName: string;
  role: string;   // agent / quality / admin / tl
  content: string;
  createdAt: string;  // ISO
}

/** Returns false if the insert failed — callers must not report success on false. */
export async function storeAppendIQSFlag(entry: IQSFlag): Promise<boolean> {
  try {
    // Ensure the conversation exists in Postgres before inserting
    const convs = await query('SELECT id FROM conversations WHERE id = $1', [String(entry.chatId)]);
    if (convs.length === 0) {
      await query(`
        INSERT INTO conversations (id, conversation_type, started_at, closed_at)
        VALUES ($1, 'agent', NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [String(entry.chatId)]);
    }

    await query(`
      INSERT INTO iqs_flags (
        id, score_id, chat_id, call_id, agent_name, agent_email, agent_note,
        challenged_params, flagged_at, updated_at, raised_by_role,
        param_category, parent_flag_id, status, reviewed_by, reviewed_at, review_note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO NOTHING
    `, [
      entry.id,
      entry.scoreId || null,
      String(entry.chatId),
      entry.callId || null,
      entry.agentName || '',
      entry.agentEmail || '',
      entry.agentNote || '',
      JSON.stringify(entry.challengedParams || []),
      entry.flaggedAt || new Date().toISOString(),
      entry.updatedAt || null,
      entry.raisedByRole,
      entry.paramCategory,
      entry.parentFlagId || null,
      entry.status,
      entry.reviewedBy || null,
      entry.reviewedAt || null,
      entry.reviewNote || null,
    ]);
    return true;
  } catch (err: any) {
    log.warn('store', 'Failed to append flag', { err: err.message });
    return false;
  }
}

export async function storeGetIQSFlags(): Promise<string[]> {
  try {
    const rows = await query(`
      SELECT
        id, score_id AS "scoreId", chat_id AS "chatId", call_id AS "callId", agent_name AS "agentName",
        agent_email AS "agentEmail", agent_note AS "agentNote", challenged_params AS "challengedParams",
        flagged_at AS "flaggedAt", updated_at AS "updatedAt", raised_by_role AS "raisedByRole",
        param_category AS "paramCategory", parent_flag_id AS "parentFlagId", status,
        reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt", review_note AS "reviewNote"
      FROM iqs_flags
      ORDER BY flagged_at DESC
    `);
    // Map dates back to ISO strings, then stringify
    return rows.map(row => {
      const entry = {
        ...row,
        flaggedAt: row.flaggedAt ? new Date(row.flaggedAt).toISOString() : '',
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
        reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : undefined,
      };
      return JSON.stringify(entry);
    });
  } catch (err: any) {
    log.warn('store', 'Failed to get flags', { err: err.message });
    return [];
  }
}

export async function storeUpdateIQSFlag(
  id: string,
  updates: Partial<Pick<IQSFlag, 'status' | 'updatedAt' | 'reviewedBy' | 'reviewedAt' | 'reviewNote'>>,
): Promise<boolean> {
  try {
    const fields: string[] = [];
    const params: any[] = [id];

    if (updates.status !== undefined) {
      params.push(updates.status);
      fields.push(`status = $${params.length}`);
    }
    if (updates.updatedAt !== undefined) {
      params.push(updates.updatedAt);
      fields.push(`updated_at = $${params.length}`);
    }
    if (updates.reviewedBy !== undefined) {
      params.push(updates.reviewedBy);
      fields.push(`reviewed_by = $${params.length}`);
    }
    if (updates.reviewedAt !== undefined) {
      params.push(updates.reviewedAt);
      fields.push(`reviewed_at = $${params.length}`);
    }
    if (updates.reviewNote !== undefined) {
      params.push(updates.reviewNote);
      fields.push(`review_note = $${params.length}`);
    }

    if (fields.length === 0) return true;

    const res = await query(`
      UPDATE iqs_flags
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING id
    `, params);

    return res.length > 0;
  } catch (err: any) {
    log.warn('store', 'Failed to update flag', { err: err.message });
    return false;
  }
}

// --- Flag Thread Comments ---

export async function storeAppendFlagComment(comment: IQSFlagComment): Promise<void> {
  try {
    await query(`
      INSERT INTO iqs_flag_comments (id, flag_id, author_email, author_name, role, content, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
    `, [
      comment.id,
      comment.flagId,
      comment.authorEmail,
      comment.authorName,
      comment.role,
      comment.content,
      comment.createdAt || new Date().toISOString(),
    ]);
  } catch (err: any) {
    log.warn('store', 'Failed to append comment', { err: err.message });
  }
}

export async function storeGetFlagThread(flagId: string): Promise<IQSFlagComment[]> {
  try {
    const rows = await query(`
      SELECT
        id, flag_id AS "flagId", author_email AS "authorEmail", author_name AS "authorName",
        role, content, created_at AS "createdAt"
      FROM iqs_flag_comments
      WHERE flag_id = $1
      ORDER BY created_at ASC
    `, [flagId]);

    return rows.map(row => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    }));
  } catch (err: any) {
    log.warn('store', 'Failed to get flag thread', { err: err.message });
    return [];
  }
}

// --- IQS Audit Trail ---

const IQS_AUDIT_KEY = 'wint_iqs_audit';

export interface IQSAuditEntry {
  id: string;
  action:
    | 'bot_scored'
    | 'dispute_raised'
    | 'ir_dispute_raised'
    | 'tl_dispute_raised'
    | 'review_submitted'
    | 'score_overridden'
    | 'dispute_resolved'
    | 'tl_forwarded_dispute'
    | 'tl_resolved_dispute'
    | 'tl_resolved_cat2'
    | 'tl_override'
    | 'tl_submit'
    | 'review_reopened';
  chatId: string;
  actorEmail: string;
  actorRole: string;
  ts: string;
  meta?: Record<string, any>;
}

export async function storeAppendAuditEntry(entry: IQSAuditEntry): Promise<void> {
  try {
    await kv_pipeline([['LPUSH', IQS_AUDIT_KEY, JSON.stringify(entry)], ['LTRIM', IQS_AUDIT_KEY, '0', '1999']]);
  } catch (e: any) { log.warn('store', 'kv audit error', { err: e?.message ?? String(e) }); }
}

export async function storeGetAuditEntries(limit = 200): Promise<IQSAuditEntry[]> {
  const raw = await kv_lrange(IQS_AUDIT_KEY, 0, limit - 1);
  return raw.map(r => { try { return JSON.parse(r) as IQSAuditEntry; } catch { return null; } }).filter(Boolean) as IQSAuditEntry[];
}

export const storeGetAuditLog = storeGetAuditEntries;

// --- Pending Score State (accumulates TICKET_CLOSED + CLASSIFICATION + CSAT before scoring) ---

const PENDING_SCORE_PREFIX  = 'wint_ps:';
const PENDING_SCORE_IDS_KEY = 'wint_ps_ids'; // Redis SET of chatIds awaiting scoring

export interface PendingScoreState {
  chatId: string;
  createdAt: string;    // ISO — when the first event for this chat arrived
  // From TICKET_CLOSED
  transcript: string;
  timedMessages: any[]; // TimedMessage[] serialised as plain objects
  agentName: string;
  date: string;
  convStarted: string;
  convEnded: string;
  hasTranscript: boolean;
  transferTimestamp?: string; // ISO — when chat was assigned to a human agent
  mobileNumber?: string;      // customer phone number (from TICKET_CLOSED webhook)
  // From CLASSIFICATION_UPDATED
  disposition: string;
  subDisposition: string;
  hasTags: boolean;
  // From CSAT_SUBMITTED
  csat: string;
  hasCsat: boolean;
}

async function kv_sadd(key: string, member: string): Promise<void> {
  try {
    await kv_pipeline([['SADD', key, member]]);
  } catch {}
}

export async function storeSavePendingScore(state: PendingScoreState): Promise<void> {
  await kv_set(`${PENDING_SCORE_PREFIX}${state.chatId}`, JSON.stringify(state));
  await kv_sadd(PENDING_SCORE_IDS_KEY, state.chatId);
}

export async function storeGetPendingScore(chatId: string): Promise<PendingScoreState | null> {
  const raw = await kv_get(`${PENDING_SCORE_PREFIX}${chatId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function storeDeletePendingScore(chatId: string): Promise<void> {
  try {
    await kv_pipeline([
      ['DEL',  `${PENDING_SCORE_PREFIX}${chatId}`],
      ['SREM', PENDING_SCORE_IDS_KEY, chatId],
    ]);
  } catch {}
}

export async function storeGetAllPendingScoreIds(): Promise<string[]> {
  if (!ready()) return [];
  try {
    const res = await fetch(`${UPSTASH_URL}/smembers/${PENDING_SCORE_IDS_KEY}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: 'no-store',
    });
    const data = await res.json();
    return Array.isArray(data.result) ? data.result : [];
  } catch { return []; }
}



// --- Pending Classifications (store until TICKET_CLOSED is scored) ---

const PENDING_TAGS_PREFIX = 'wint_tags_pending:';

export async function storePendingTags(
  chatId: string | number,
  disposition: string,
  subDisposition: string,
): Promise<void> {
  await kv_set(`${PENDING_TAGS_PREFIX}${chatId}`, JSON.stringify({ disposition, subDisposition }));
}

export async function storeGetAndClearPendingTags(
  chatId: string | number,
): Promise<{ disposition: string; subDisposition: string } | null> {
  const val = await kv_get(`${PENDING_TAGS_PREFIX}${chatId}`);
  if (val && ready()) {
    try {
      await kv_pipeline([['DEL', `${PENDING_TAGS_PREFIX}${chatId}`]]);
    } catch {}
    try { return JSON.parse(val); } catch {}
  }
  return null;
}

// --- Pending CSAT (store rating until TICKET_CLOSED is scored) ---

const PENDING_CSAT_PREFIX = 'wint_csat_pending:';

export async function storePendingCsat(chatId: string | number, csat: string): Promise<void> {
  await kv_set(`${PENDING_CSAT_PREFIX}${chatId}`, csat);
}

export async function storeGetAndClearPendingCsat(chatId: string | number): Promise<string | null> {
  const val = await kv_get(`${PENDING_CSAT_PREFIX}${chatId}`);
  if (val && ready()) {
    // Delete after reading
    try {
      await kv_pipeline([['DEL', `${PENDING_CSAT_PREFIX}${chatId}`]]);
    } catch {}
  }
  return val;
}

// --- Transcripts (stored separately from IQS scores to keep list lean) ---

const TRANSCRIPT_PREFIX = 'wint_t:';

export async function storeSetTranscript(
  chatId: string,
  data: { timedMessages?: any[]; rawTranscript?: string; disposition?: string; subDisposition?: string },
): Promise<void> {
  await kv_set(`${TRANSCRIPT_PREFIX}${chatId}`, JSON.stringify(data));
}

export async function storeGetTranscript(
  chatId: string,
): Promise<{ timedMessages?: any[]; rawTranscript?: string; disposition?: string; subDisposition?: string } | null> {
  const raw = await kv_get(`${TRANSCRIPT_PREFIX}${chatId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// --- Conversations ---

export async function storeGetConversations(username: string): Promise<SavedConversation[]> {
  const raw = await kv_get(`convs:${username}`);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function storeSetConversations(username: string, convs: SavedConversation[]): Promise<void> {
  await kv_set(`convs:${username}`, JSON.stringify(convs));
}

// ── Call-skipped chats (chats pending manual QA review) ────────────────────

const CALL_SKIPPED_KEY = 'wint_call_skipped';

export interface CallSkippedEntry {
  id: string;
  chatId: string;
  agentName: string;
  reason: string;
  skippedAt: string;
  status: 'pending' | 'reviewed';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export async function storeAppendCallSkipped(entry: CallSkippedEntry): Promise<void> {
  try {
    await kv_pipeline([['LPUSH', CALL_SKIPPED_KEY, JSON.stringify(entry)], ['LTRIM', CALL_SKIPPED_KEY, '0', '999']]);
  } catch {}
}

// --- QA Review Status (per-chat review tracking for pending IQS < 80% chats) ---

const QA_REVIEW_PREFIX = 'wint_qa_review:';

export async function storeGetQAReview(chatId: string): Promise<{ reviewedBy: string; reviewedAt: string; reviewNote: string } | null> {
  const val = await kv_get(`${QA_REVIEW_PREFIX}${chatId}`);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

export async function storeSetQAReview(chatId: string, data: { reviewedBy: string; reviewedAt: string; reviewNote: string }): Promise<void> {
  await kv_set(`${QA_REVIEW_PREFIX}${chatId}`, JSON.stringify(data));
}

export async function storeGetCallSkipped(): Promise<string[]> {
  return kv_lrange(CALL_SKIPPED_KEY, 0, -1);
}

export async function storeUpdateCallSkipped(
  id: string,
  updates: Partial<Pick<CallSkippedEntry, 'status' | 'reviewedBy' | 'reviewedAt' | 'reviewNote'>>,
): Promise<boolean> {
  if (!ready()) return false;
  const all = await storeGetCallSkipped();
  const idx = all.findIndex(raw => { try { return JSON.parse(raw).id === id; } catch { return false; } });
  if (idx < 0) return false;
  try {
    const entry = { ...JSON.parse(all[idx]), ...updates };
    await kv_pipeline([['LSET', CALL_SKIPPED_KEY, String(idx), JSON.stringify(entry)]]);
    return true;
  } catch { return false; }
}

