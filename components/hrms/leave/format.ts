import { MON, WD, fd } from '../ui';

/** Wording helpers from the prototype's data files, on YYYY-MM-DD dates. */
export const fr = (s: string, e?: string | null) => (!e || s === e ? fd(s) : `${fd(s)} – ${fd(e)}`);
export const sdt = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const nd = (n: number) => { const v = Math.round(n * 4) / 4; return (v < 0 ? '−' : '') + String(Math.abs(v)); };
export const dayW = (n: number) => `${nd(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
export const halfLabel = (s: string, e: string, sh: string, eh: string) => {
  if (s === e) return sh === 'first' ? 'First half' : sh === 'second' ? 'Second half' : 'Full day';
  if (sh === 'second' && eh === 'first') return 'Starts second half, ends first half';
  if (sh === 'second') return 'Starts second half'; if (eh === 'first') return 'Ends first half'; return 'Full days';
};
export const monthName = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1]} ${y}`; };
export const addMonths = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/**
 * The payroll month a day falls in. The month runs from the 25th to the 24th and is named after the month it ends in:
 * 25 Oct – 24 Nov is "Nov 2026". `key` sorts ('2026-11'), `label` is what people read.
 */
export function payrollOf(day: string): { key: string; label: string } {
  const [y, m, d] = day.split('-').map(Number);
  const mm = d >= 25 ? m + 1 : m; const yy = mm > 12 ? y + 1 : y; const mi = ((mm - 1) % 12);
  return { key: `${yy}-${String(mi + 1).padStart(2, '0')}`, label: `${MON[mi]} ${yy}` };
}
/** '25 Oct – 24 Nov' for the payroll month key '2026-11'. */
export const payrollSpan = (key: string) => { const mi = Number(key.slice(5, 7)) - 1; return `25 ${MON[(mi + 11) % 12]} – 24 ${MON[mi]}`; };
