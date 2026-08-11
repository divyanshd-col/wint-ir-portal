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
  return checkRateLimit(key, limit, windowSecs, /* failClosed */ false);
}

/**
 * Fail-CLOSED variant for authentication: if the limiter is unavailable or
 * errors, treat the request as rate-limited (blocked) instead of silently
 * allowing unlimited attempts. Use for the login path.
 */
export async function isRateLimitedFailClosed(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<boolean> {
  return checkRateLimit(key, limit, windowSecs, /* failClosed */ true);
}

async function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number,
  failClosed: boolean,
): Promise<boolean> {
  if (!ready()) return failClosed;
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
    if (!res.ok) return failClosed;
    const data = await res.json();
    const count = Array.isArray(data.result) ? data.result[0] : 1;
    return count > limit;
  } catch {
    return failClosed;
  }
}

/**
 * Break-glass allow-list: admin emails that bypass the per-account limiter so
 * an admin can always get in to fix a limiter outage. Configured via env
 * BREAK_GLASS_ADMIN_EMAILS (comma-separated). They remain subject to per-IP
 * limiting.
 */
export function isBreakGlassAdmin(email: string): boolean {
  const raw = process.env.BREAK_GLASS_ADMIN_EMAILS || '';
  if (!raw) return false;
  const target = email.trim().toLowerCase();
  return raw
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}
