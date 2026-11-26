export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** One fetch wrapper for every HRMS screen: JSON in, JSON out, errors as text the person can read. */
export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: j as T } : { ok: false, error: (j as { error?: string }).error || 'Something went wrong. Try again.', status: r.status };
  } catch { return { ok: false, error: 'Couldn’t reach the server. Try again.', status: 0 }; }
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ist = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60000); // shift so the UTC getters read IST
/** 'Thu, 19 Nov · 3:06 pm' (IST), as the prototype writes times. `year` adds the year. */
export function whenIst(iso: string, year = false): string {
  const d = ist(iso); const h = d.getUTCHours();
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''} · ${((h + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** The date part alone, 'Thu, 19 Nov 2026'. */
export const dateIst = (iso: string) => { const d = ist(iso); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
