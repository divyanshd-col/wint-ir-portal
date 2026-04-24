/**
 * Persistent storage via Upstash Redis REST API.
 * Falls back to no-op if env vars not set (local dev uses file only).
 */

import type { PortalConfig } from './config';
import type { KnowledgeChunk, SavedConversation } from './types';

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

async function kv_set(key: string, value: string): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([['SET', key, value]]),
    });
  } catch {}
}

async function kv_lpush(key: string, value: string): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      // Keep last 500 log entries
      body: JSON.stringify([['LPUSH', key, value], ['LTRIM', key, '0', '499']]),
    });
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
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      // SET NX EX 600 — only sets if key doesn't exist; returns "OK" or null
      body: JSON.stringify([['SET', `wint_scoring_lock:${chatId}`, '1', 'EX', '600', 'NX']]),
    });
    const data = await res.json();
    const result = Array.isArray(data.result) ? data.result[0] : data.result;
    return result === 'OK';
  } catch {
    return true; // on KV error, let scoring proceed
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
  if (!ready()) return;
  try {
    // Expires after 2 h — long enough to catch retries, short enough to not bloat KV
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', `wint_webhook_event:${eventId}`, '1', 'EX', '7200']]),
    });
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
  if (!ready()) return;
  try {
    // SET with EX 86400 = expires after 24 h
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', `wint_quality_alerted:${chatId}`, '1', 'EX', '86400']]),
    });
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
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LPUSH', CORRECTIONS_KEY, JSON.stringify(entry)], ['LTRIM', CORRECTIONS_KEY, '0', '199']]),
    });
  } catch {}
}

export async function storeGetCorrections(): Promise<string[]> {
  return kv_lrange(CORRECTIONS_KEY, 0, -1);
}

export async function storeSetCorrections(entries: object[]): Promise<void> {
  await kv_set(CORRECTIONS_KEY, JSON.stringify(entries));
}

// --- IQS Quality Scores ---

const IQS_SCORES_KEY = 'wint_iqs_scores';

export async function storeAppendIQSScore(entry: object): Promise<void> {
  if (!ready()) return;
  try {
    // No LTRIM — scores are kept forever
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LPUSH', IQS_SCORES_KEY, JSON.stringify(entry)]]),
    });
  } catch {}
}

export async function storeGetIQSScores(limit = 0, start = 0): Promise<string[]> {
  // limit=0 → return ALL entries. Use storeGetAllIQSScores() for safe batched access.
  if (limit <= 0) return kv_lrange(IQS_SCORES_KEY, 0, -1);
  return kv_lrange(IQS_SCORES_KEY, start, start + limit - 1);
}

/**
 * Fetch ALL IQS score entries safely by issuing parallel 500-entry LRANGE batches.
 * Each batch response stays well under Upstash's 1 MB limit (~150 KB per batch).
 * Total latency ≈ one round-trip because all batches fire simultaneously.
 */
export async function storeGetAllIQSScores(): Promise<string[]> {
  const total = await storeGetIQSScoreCount();
  if (total === 0) return [];
  const BATCH = 500;
  const batchCount = Math.ceil(total / BATCH);
  const results = await Promise.all(
    Array.from({ length: batchCount }, (_, i) => storeGetIQSScores(BATCH, i * BATCH))
  );
  return results.flat();
}

export async function storeGetIQSScoreCount(): Promise<number> {
  if (!ready()) return 0;
  try {
    const res = await fetch(`${UPSTASH_URL}/llen/${IQS_SCORES_KEY}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: 'no-store',
    });
    const data = await res.json();
    return typeof data.result === 'number' ? data.result : 0;
  } catch {
    return 0;
  }
}

/**
 * Scan the IQS score list in 500-entry batches and call `match(entry)` on each.
 * When match returns a non-null update object, LSET that index and return true.
 * Avoids the Upstash 1 MB single-response limit that silently breaks lrange(0,-1).
 */
async function kv_scanAndUpdate(
  match: (entry: any) => Record<string, any> | null,
): Promise<boolean> {
  if (!ready()) return false;
  const total = await storeGetIQSScoreCount();
  if (total === 0) return false;
  const BATCH = 500;
  for (let start = 0; start < total; start += BATCH) {
    const batch = await kv_lrange(IQS_SCORES_KEY, start, start + BATCH - 1);
    for (let j = 0; j < batch.length; j++) {
      try {
        const entry = JSON.parse(batch[j]);
        const updates = match(entry);
        if (updates !== null) {
          const updated = { ...entry, ...updates };
          await fetch(`${UPSTASH_URL}/pipeline`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([['LSET', IQS_SCORES_KEY, String(start + j), JSON.stringify(updated)]]),
          });
          return true;
        }
      } catch {}
    }
  }
  return false;
}

/** Update the csat field on an existing IQS score by chatId. Returns true if found & updated. */
export async function storeUpdateIQSScoreCsat(chatId: string, csat: string): Promise<boolean> {
  return kv_scanAndUpdate(entry =>
    String(entry.chatId) === String(chatId) ? { csat } : null
  );
}

// --- IQS Score Flags (agent disputes a score, sent to quality for review) ---

const IQS_FLAGS_KEY = 'wint_iqs_flags';

export interface IQSChallengedParam {
  param: string;   // e.g. "Opening"
  note: string;    // agent's specific note for this param
}

export interface IQSFlag {
  id: string;
  scoreId: string;
  chatId: string;
  agentName: string;
  agentEmail: string;
  agentNote: string;           // overall note
  challengedParams?: IQSChallengedParam[];  // per-parameter challenges
  flaggedAt: string;           // ISO
  status: 'pending' | 'reviewed';
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

export async function storeAppendIQSFlag(entry: IQSFlag): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LPUSH', IQS_FLAGS_KEY, JSON.stringify(entry)], ['LTRIM', IQS_FLAGS_KEY, '0', '999']]),
    });
  } catch {}
}

export async function storeGetIQSFlags(): Promise<string[]> {
  return kv_lrange(IQS_FLAGS_KEY, 0, -1);
}

export async function storeUpdateIQSFlag(
  id: string,
  updates: Partial<Pick<IQSFlag, 'status' | 'reviewedBy' | 'reviewedAt' | 'reviewNote'>>,
): Promise<boolean> {
  if (!ready()) return false;
  const all = await storeGetIQSFlags();
  const idx = all.findIndex(raw => { try { return JSON.parse(raw).id === id; } catch { return false; } });
  if (idx < 0) return false;
  try {
    const entry = { ...JSON.parse(all[idx]), ...updates };
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LSET', IQS_FLAGS_KEY, String(idx), JSON.stringify(entry)]]),
    });
    return true;
  } catch { return false; }
}

// --- Flag Thread Comments ---

function flagThreadKey(flagId: string) { return `wint_iqs_thread:${flagId}`; }

export async function storeAppendFlagComment(comment: IQSFlagComment): Promise<void> {
  if (!ready()) return;
  try {
    const key = flagThreadKey(comment.flagId);
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['RPUSH', key, JSON.stringify(comment)], ['LTRIM', key, '-200', '-1']]),
    });
  } catch {}
}

export async function storeGetFlagThread(flagId: string): Promise<IQSFlagComment[]> {
  const raw = await kv_lrange(flagThreadKey(flagId), 0, -1);
  return raw.map(r => { try { return JSON.parse(r) as IQSFlagComment; } catch { return null; } }).filter(Boolean) as IQSFlagComment[];
}

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
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SADD', key, member]]),
    });
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
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['DEL',  `${PENDING_SCORE_PREFIX}${chatId}`],
        ['SREM', PENDING_SCORE_IDS_KEY, chatId],
      ]),
    });
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

/** Update disposition + subDisposition on an existing IQS score by chatId. */
export async function storeUpdateIQSScoreTags(
  chatId: string,
  disposition: string,
  subDisposition: string,
): Promise<boolean> {
  return kv_scanAndUpdate(entry =>
    String(entry.chatId) === String(chatId)
      ? { disposition, subDisposition, tags: disposition }
      : null
  );
}

/** Update any fields on an existing IQS score entry by id+chatId. Returns true if found & updated. */
export async function storeUpdateIQSScoreEntry(
  id: string,
  chatId: string,
  updates: Record<string, any>,
): Promise<boolean> {
  return kv_scanAndUpdate(entry =>
    String(entry.id) === String(id) && String(entry.chatId) === String(chatId)
      ? updates
      : null
  );
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
      await fetch(`${UPSTASH_URL}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['DEL', `${PENDING_TAGS_PREFIX}${chatId}`]]),
      });
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
      await fetch(`${UPSTASH_URL}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['DEL', `${PENDING_CSAT_PREFIX}${chatId}`]]),
      });
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
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LPUSH', CALL_SKIPPED_KEY, JSON.stringify(entry)], ['LTRIM', CALL_SKIPPED_KEY, '0', '999']]),
    });
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
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['LSET', CALL_SKIPPED_KEY, String(idx), JSON.stringify(entry)]]),
    });
    return true;
  } catch { return false; }
}
