import type { HistoryEntry } from './types';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_ENTRIES   = 50;

function ready(): boolean {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

function historyKey(email: string): string {
  return `wint_analytics_history:${email}`;
}

export async function appendHistory(email: string, entry: HistoryEntry): Promise<void> {
  if (!ready()) return;
  const key = historyKey(email);
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['LPUSH', key, JSON.stringify(entry)],
        ['LTRIM', key, '0', String(MAX_ENTRIES - 1)],
      ]),
    });
  } catch {}
}

export async function getHistory(email: string): Promise<HistoryEntry[]> {
  if (!ready()) return [];
  const key = historyKey(email);
  try {
    const res = await fetch(`${UPSTASH_URL}/lrange/${key}/0/${MAX_ENTRIES - 1}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: 'no-store',
    });
    const data = await res.json();
    const items: string[] = Array.isArray(data.result) ? data.result : [];
    return items
      .map(s => { try { return JSON.parse(s) as HistoryEntry; } catch { return null; } })
      .filter(Boolean) as HistoryEntry[];
  } catch {
    return [];
  }
}
