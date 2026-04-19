import { query } from '@/lib/cx/db';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CACHE_KEY     = 'wint_analytics_dispositions';
const TTL_SECS      = 6 * 60 * 60; // 6 hours

function ready(): boolean {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

export interface DispositionTree {
  disposition: string;
  subDispositions: string[];
}

export interface DispositionsPayload {
  dispositions: DispositionTree[];
  agents: { id: number; name: string }[];
}

async function kvGet(key: string): Promise<string | null> {
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

async function kvSetEx(key: string, value: string, ttlSecs: number): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, value, 'EX', String(ttlSecs)]]),
    });
  } catch {}
}

async function fetchFromDB(): Promise<DispositionsPayload> {
  const [dispRows, agentRows] = await Promise.all([
    query<{ d: string; s: string }>(`
      SELECT DISTINCT
        tags->>'disposition'     AS d,
        tags->>'sub_disposition' AS s
      FROM conversations
      WHERE tags->>'disposition' IS NOT NULL
        AND tags->>'disposition' != ''
      ORDER BY 1, 2
    `),
    query<{ id: number; name: string }>(`
      SELECT id, name FROM agents WHERE status = 'active' ORDER BY name
    `),
  ]);

  const treeMap = new Map<string, string[]>();
  for (const row of dispRows) {
    if (!treeMap.has(row.d)) treeMap.set(row.d, []);
    if (row.s && row.s.trim()) treeMap.get(row.d)!.push(row.s);
  }
  const dispositions: DispositionTree[] = Array.from(treeMap.entries()).map(
    ([disposition, subDispositions]) => ({ disposition, subDispositions }),
  );

  return { dispositions, agents: agentRows };
}

export async function getDispositions(): Promise<DispositionsPayload> {
  const cached = await kvGet(CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  const payload = await fetchFromDB();
  await kvSetEx(CACHE_KEY, JSON.stringify(payload), TTL_SECS);
  return payload;
}

export async function invalidateDispositionsCache(): Promise<void> {
  if (!ready()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['DEL', CACHE_KEY]]),
    });
  } catch {}
}
