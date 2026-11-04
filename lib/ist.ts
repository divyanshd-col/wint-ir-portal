/** All roster dates are IST calendar dates ('YYYY-MM-DD'). The server runs on UTC, so never use `new Date()` day parts directly. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function toIstDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function todayIST(now: Date = new Date()): string {
  return toIstDate(now);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}
export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
