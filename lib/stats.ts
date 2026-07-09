export function csatScore(csat: string | number | undefined | null): number | null {
  if (csat === '5' || csat === 5) return 100;
  if (csat === '3' || csat === 3) return 50;
  if (csat === '1' || csat === 1) return 0;
  return null;
}

export function avgOrNull(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

export function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

export function getWeekKey(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - day + 1);
  return mon.toISOString().slice(0, 10);
}

export function getWeekLabel(key: string): string {
  const mon = new Date(key + 'T00:00:00Z');
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}
