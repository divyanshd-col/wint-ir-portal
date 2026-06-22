/**
 * Sliding-window rate limiter backed by Upstash Redis.
 * Falls back to allow-all if KV is not configured (local dev).
 */

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let _warnedOnce = false;
function ready(): boolean {
  if (!(UPSTASH_URL && UPSTASH_TOKEN)) {
    if (!_warnedOnce) {
      console.warn('[rate-limit] Upstash KV not configured — rate limiting is DISABLED');
      _warnedOnce = true;
    }
    return false;
  }
  return true;
}

/**
 * Returns true if the request should be blocked.
 * Uses a fixed window of `windowSecs` with a max of `limit` requests.
 */
export async function isRateLimited(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<boolean> {
  if (!ready()) return false;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', `rl:${key}`],
        ['EXPIRE', `rl:${key}`, String(windowSecs)],
      ]),
    });
    const data = await res.json();
    const count = Array.isArray(data.result) ? data.result[0] : 1;
    return count > limit;
  } catch {
    return false;
  }
}
