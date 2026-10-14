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
