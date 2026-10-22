/** Small pure helpers shared by the Email Quality pages (QA, Team Lead and Agent views). */

export const robylonTicketUrl = (chatId: string | number) => `https://app.robylon.ai/unified-inbox/share/${String(chatId).trim()}`;

export type Period = 'all' | '7' | '30' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
// Local calendar date (not toISOString, which can slip a day across the UTC boundary for IST users).
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Inclusive calendar-day range for the All / 7 days / 30 days / Custom range control. Custom without both dates falls back to 7 days. */
export function resolveDateRange(period: Period, customFrom: string | undefined, customTo: string | undefined, now = new Date()): { from: string; to: string } {
  if (period === 'all') return { from: '', to: '' };
  if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
  if (period === 'custom' && (!customFrom || !customTo)) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return { from: ymd(start), to: ymd(now) };
  }
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
  if (!from || !to) return { from: '', to: '' };
  return { from: dayStart(from, false), to: dayStart(to, true) };
}

/** Query-ready from/to instants for the period control. */
export function periodBounds(period: Period, customFrom?: string, customTo?: string): { from: string; to: string } {
  const r = resolveDateRange(period, customFrom, customTo);
  if (!r.from || !r.to) return { from: '', to: '' };
  return dayBoundsISO(r.from, r.to);
}

const DISPUTE_LABELS: Record<string, string> = {
  Raised: 'Raised by agent',
  Under_Review: 'Forwarded to QA',
  TL_Resolved: 'Resolved by TL',
  Resolved: 'Resolved by QA',
  Rejected: 'Rejected by QA',
};

/** Dispute status in plain words (mirrors the chat dispute labels); a dash when there is no dispute. */
export function disputeLabel(status: string | null | undefined, qaName?: any): string {
  const nameStr = typeof qaName === 'string' && qaName.trim() ? qaName.trim() : null;
  if (status === 'Under_Review') {
    return nameStr && nameStr.toLowerCase() !== 'qa' ? `Forwarded to ${nameStr}` : 'Forwarded to QA';
  }
  if (status === 'Resolved') {
    return nameStr && nameStr.toLowerCase() !== 'qa' ? `Resolved by ${nameStr}` : 'Resolved by QA';
  }
  if (status === 'Rejected') {
    return nameStr && nameStr.toLowerCase() !== 'qa' ? `Rejected by ${nameStr}` : 'Rejected by QA';
  }
  return DISPUTE_LABELS[status ?? ''] ?? '—';
}

export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

/** One page of rows (1-based); an out-of-range page clamps to the last one. */
export function pageSlice<T>(items: T[], page: number, size: number): T[] {
  const p = Math.min(Math.max(1, page), pageCount(items.length, size));
  return items.slice((p - 1) * size, p * size);
}

export type ParamChoice = 'yes' | 'half' | 'no' | 'na';

/** Which of the four buttons a stored parameter value selects; null for a missing or numeric value. */
export function paramChoice(v: unknown): ParamChoice | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'yes' || s === 'pass') return 'yes';
  if (s === 'half' || s === 'partial') return 'half';
  if (s === 'no' || s === 'fail') return 'no';
  if (s === 'na' || s === 'n/a') return 'na';
  return null;
}
