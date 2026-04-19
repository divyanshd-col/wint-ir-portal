/** Returns the Monday (ISO week start) for a given date as YYYY-MM-DD */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Last 8 completed week_start values (Mondays), most recent first */
export function getLast8Weeks(): string[] {
  const today = new Date();
  const thisWeekStart = getWeekStart(today);
  const weeks: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const d = new Date(thisWeekStart);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

/** Returns YYYY-MM-DD date of the most recent completed week (last Monday) */
export function getLastCompletedWeekStart(): string {
  const w = getLast8Weeks();
  return w[0];
}

/** Previous week's Monday given a week_start string */
export function prevWeek(weekStart: string): string {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/** Check if a week_start is the current in-progress week */
export function isInProgress(weekStart: string): boolean {
  return weekStart === getWeekStart();
}
