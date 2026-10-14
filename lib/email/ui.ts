/** Small pure helpers shared by the Email Quality pages (QA, Team Lead and Agent views). */

export const robylonTicketUrl = (chatId: string | number) => `https://app.robylon.ai/unified-inbox/share/${String(chatId).trim()}`;

export type Period = '7' | '30' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
// Local calendar date (not toISOString, which can slip a day across the UTC boundary for IST users).
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Inclusive calendar-day range for the 7 days / 30 days / Custom range control. Custom without both dates falls back to 7 days. */
export function resolveDateRange(period: Period, customFrom: string | undefined, customTo: string | undefined, now = new Date()): { from: string; to: string } {
  if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
  const days = period === '30' ? 30 : 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: ymd(start), to: ymd(now) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L1 intent (KYC, Liquidity, ...) for a table cell; a dash when Robylon has not classified the ticket ("None", empty, or a raw id). */
export function intentLabel(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  return !t || t.toLowerCase() === 'none' || UUID.test(t) ? '—' : t;
}

const TRAILING_EMPTY = /(?:\s|&nbsp;|<br\s*\/?>|<(p|div|span)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>)+$/i;

/** Email body for the review panels: no trailing blank lines or empty html blocks, and no runs of 3+ newlines (chats-style tight preview). */
export function trimEmailBody(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(TRAILING_EMPTY, '').trim();
}

/** Plain-text label for a stored parameter value (yes/half/no/na, or a numeric score), a dash when missing. */
export function paramLabel(v: unknown): string {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s) return '—';
  if (s === 'yes' || s === 'pass') return 'Yes';
  if (s === 'half' || s === 'partial') return 'Half';
  if (s === 'no' || s === 'fail') return 'No';
  if (s === 'na' || s === 'n/a') return 'NA';
  return `${v}%`;
}

const dayStart = (ymdStr: string, end: boolean) => {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return (end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)).toISOString();
};

/** from/to calendar days -> local day start / day end as ISO instants, so "today" means the viewer's today, not UTC's. */
export function dayBoundsISO(from: string, to: string): { from: string; to: string } {
  return { from: dayStart(from, false), to: dayStart(to, true) };
}

/** Query-ready from/to instants for the period control. */
export function periodBounds(period: Period, customFrom?: string, customTo?: string): { from: string; to: string } {
  const r = resolveDateRange(period, customFrom, customTo);
  return dayBoundsISO(r.from, r.to);
}
