const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_SECS = 8 * 60 * 60; // 8 hours

function key(sessionId: string, agentId: string) {
  return `cx_temp:${sessionId}:${agentId}`;
}

async function upstash(cmd: any[]) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd]),
  });
  const data = await res.json();
  return data[0]?.result ?? null;
}

export interface TempAssignment {
  agentId: string;
  fromTeamId: string;
  toTeamId: string;
  appliedAt: string;
  expiresAt: string;
}

export async function setTempAssignment(
  sessionId: string,
  agentId: string,
  fromTeamId: string,
  toTeamId: string,
): Promise<TempAssignment> {
  const appliedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TTL_SECS * 1000).toISOString();
  const value: TempAssignment = { agentId, fromTeamId, toTeamId, appliedAt, expiresAt };
  await upstash(['SET', key(sessionId, agentId), JSON.stringify(value), 'EX', TTL_SECS]);
  return value;
}

export async function getTempAssignment(sessionId: string, agentId: string): Promise<TempAssignment | null> {
  const raw = await upstash(['GET', key(sessionId, agentId)]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function deleteTempAssignment(sessionId: string, agentId: string): Promise<void> {
  await upstash(['DEL', key(sessionId, agentId)]);
}

/** Get all temp assignments for this session (for display) */
export async function getAllTempAssignments(sessionId: string): Promise<TempAssignment[]> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return [];
  try {
    const scanRes = await fetch(`${UPSTASH_URL}/scan/0/match/cx_temp:${sessionId}:*/count/100`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const scanData = await scanRes.json();
    const keys: string[] = scanData.result?.[1] ?? [];
    if (!keys.length) return [];
    const pipeline = keys.map(k => ['GET', k]);
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
    });
    const data = await res.json();
    return (data as any[]).map(d => { try { return JSON.parse(d.result); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
