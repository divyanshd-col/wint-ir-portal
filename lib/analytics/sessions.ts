import type { HistoryEntry } from './types';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_SESSIONS  = 12;
const MAX_MESSAGES  = 50;

function ready(): boolean {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function sessionsIndexKey(email: string)                          { return `wint_analytics_sessions:${email}`; }
function sessionMessagesKey(email: string, sessionId: string)     { return `wint_analytics_session_msgs:${email}:${sessionId}`; }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
}

export interface SessionWithMessages extends SessionMeta {
  messages: HistoryEntry[];
}

// ── Upstash helpers ───────────────────────────────────────────────────────────

async function redisPipeline(commands: any[][]): Promise<any> {
  if (!ready()) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    return res.json();
  } catch { return null; }
}

async function redisLRange(key: string, start: number, stop: number): Promise<string[]> {
  if (!ready()) return [];
  try {
    const res = await fetch(`${UPSTASH_URL}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: 'no-store',
    });
    const data = await res.json();
    return Array.isArray(data?.result) ? data.result : [];
  } catch { return []; }
}

function parseJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

// ── Session index helpers ─────────────────────────────────────────────────────

async function readSessionIndex(email: string): Promise<SessionMeta[]> {
  const items = await redisLRange(sessionsIndexKey(email), 0, MAX_SESSIONS - 1);
  return items.map(s => parseJson<SessionMeta>(s)).filter(Boolean) as SessionMeta[];
}

async function writeSessionIndex(email: string, sessions: SessionMeta[]): Promise<void> {
  if (!sessions.length) {
    await redisPipeline([['DEL', sessionsIndexKey(email)]]);
    return;
  }
  // Rebuild list: DEL + RPUSH each in order (oldest → newest left → right)
  const commands: any[][] = [['DEL', sessionsIndexKey(email)]];
  for (const s of sessions) {
    commands.push(['RPUSH', sessionsIndexKey(email), JSON.stringify(s)]);
  }
  await redisPipeline(commands);
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

export async function createSession(email: string, title: string): Promise<string> {
  const id = crypto.randomUUID();
  const meta: SessionMeta = { id, title, createdAt: new Date().toISOString() };
  // Append to end (newest right), trim oldest if over limit
  await redisPipeline([
    ['RPUSH', sessionsIndexKey(email), JSON.stringify(meta)],
    ['LTRIM', sessionsIndexKey(email), -MAX_SESSIONS, -1],
  ]);
  return id;
}

export async function updateSessionTitle(email: string, sessionId: string, title: string): Promise<void> {
  const sessions = await readSessionIndex(email);
  const updated = sessions.map(s => s.id === sessionId ? { ...s, title } : s);
  await writeSessionIndex(email, updated);
}

export async function deleteSession(email: string, sessionId: string): Promise<void> {
  const sessions = await readSessionIndex(email);
  const remaining = sessions.filter(s => s.id !== sessionId);
  const commands: any[][] = [
    ['DEL', sessionMessagesKey(email, sessionId)],
    ['DEL', sessionsIndexKey(email)],
  ];
  for (const s of remaining) {
    commands.push(['RPUSH', sessionsIndexKey(email), JSON.stringify(s)]);
  }
  await redisPipeline(commands);
}

// ── Message storage ───────────────────────────────────────────────────────────

export async function appendToSession(email: string, sessionId: string, entry: HistoryEntry): Promise<void> {
  if (!ready()) return;
  const key = sessionMessagesKey(email, sessionId);
  await redisPipeline([
    ['LPUSH', key, JSON.stringify(entry)],
    ['LTRIM', key, '0', String(MAX_MESSAGES - 1)],
  ]);
}

async function getSessionMessages(email: string, sessionId: string): Promise<HistoryEntry[]> {
  const items = await redisLRange(sessionMessagesKey(email, sessionId), 0, MAX_MESSAGES - 1);
  return items.map(s => parseJson<HistoryEntry>(s)).filter(Boolean) as HistoryEntry[];
}

// ── Bulk loader ───────────────────────────────────────────────────────────────

export async function getAllSessions(email: string): Promise<SessionWithMessages[]> {
  const index = await readSessionIndex(email);
  if (!index.length) return [];
  const withMessages = await Promise.all(
    index.map(async meta => ({
      ...meta,
      messages: await getSessionMessages(email, meta.id),
    })),
  );
  return withMessages;
}

// ── Legacy stubs (kept so old imports don't break) ────────────────────────────

export async function appendHistory(_email: string, _entry: HistoryEntry): Promise<void> {}
export async function getHistory(_email: string): Promise<HistoryEntry[]> { return []; }
