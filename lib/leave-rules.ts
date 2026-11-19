import { addDays } from '@/lib/ist';
import { daysBetween, dayHalf, dayWeight, quarter, type Half, type LeaveKind, type LeaveRequest } from '@/lib/leave';

/** The rules that decide a leave request. No database in here, so every rule is unit-tested. Amounts are quarter days. */
export interface Rules {
  negativeLimit: number;
  threshold1: number;   // days away in a row up to which the system approves by itself
  threshold2: number;   // above this only an admin can approve
  maxLength: number;    // above this the request is auto-rejected (it can still be sent up)
  b1Len: number; b1Days: number; b2Len: number; b2Days: number; b3Days: number;   // notice bands
}
export const RULE_KEYS = ['threshold_1', 'threshold_2', 'max_length', 'notice_band_1_length', 'notice_band_1_days', 'notice_band_2_length', 'notice_band_2_days', 'notice_band_3_days'] as const;

/** Turns the settings table into rules. Anything missing or not a number is reported, never defaulted: apply stays closed. */
export function parseRules(settings: Record<string, string>): { rules: Rules | null; missing: string[] } {
  const num = (k: string) => { const v = settings[k]; if (v === undefined || v.trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const missing = RULE_KEYS.filter(k => num(k) === null || (num(k) as number) < 0);
  if (missing.length) return { rules: null, missing: [...missing] };
  const neg = num('negative_limit');
  return { missing: [], rules: {
    negativeLimit: neg ?? -2, threshold1: num('threshold_1')!, threshold2: num('threshold_2')!, maxLength: num('max_length')!,
    b1Len: num('notice_band_1_length')!, b1Days: num('notice_band_1_days')!, b2Len: num('notice_band_2_length')!, b2Days: num('notice_band_2_days')!, b3Days: num('notice_band_3_days')!,
  } };
}

export interface RequestDays { start_date: string; end_date: string; start_half: Half; end_half: Half }
export interface Charged { day: string; half: Half; weight: number }

/** The working days a request covers. Week-offs are not charged. A rostered holiday is a working day and costs 1. */
export function chargedDays(r: RequestDays, isOff: (day: string) => boolean, hasType: (day: string) => boolean): Charged[] {
  const out: Charged[] = [];
  for (const day of daysBetween(r.start_date, r.end_date)) {
    if (!hasType(day) || isOff(day)) continue;
    const w = dayWeight(r as LeaveRequest, day);
    if (w) out.push({ day, half: dayHalf(r as LeaveRequest, day), weight: w });
  }
  return out;
}

export interface SplitLine { day: string; kind: LeaveKind; half: Half; charge: number }
const floorQuarter = (n: number) => Math.floor(n * 4 + 1e-9) / 4;

/**
 * Part of the request comes from balance, the rest is LOP. Balance can go down to the negative limit: with -1.75 and a limit
 * of -2, one day is 0.25 leave and 0.75 LOP. Earliest days take the balance first. `available` is the balance not held by
 * other waiting requests.
 */
export function splitLeaveLop(days: Charged[], available: number, negativeLimit: number): { lines: SplitLine[]; leave: number; lop: number } {
  let room = Math.max(0, floorQuarter(available - negativeLimit));
  const lines: SplitLine[] = [];
  let leave = 0, lop = 0;
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const l = quarter(Math.min(d.weight, room));
    const p = quarter(d.weight - l);
    room = quarter(room - l);
    if (l > 0) { lines.push({ day: d.day, kind: 'leave', half: d.half, charge: l }); leave = quarter(leave + l); }
    if (p > 0) { lines.push({ day: d.day, kind: 'lop', half: d.half, charge: p }); lop = quarter(lop + p); }
  }
  return { lines, leave, lop };
}

/**
 * Days away in a row: the request's full days plus anything touching them that is a week-off or already-approved full-day
 * leave. Half days break a stretch. Returns 0 when the request has only half days (it is judged as 1 day).
 */
export function stretchDays(a: { requestFullDays: string[]; approvedFullDays: Set<string>; isOff: (day: string) => boolean }): number {
  const mine = new Set(a.requestFullDays);
  const away = (d: string) => mine.has(d) || a.approvedFullDays.has(d) || a.isOff(d);
  let best = 0;
  const seen = new Set<string>();
  for (const d of a.requestFullDays) {
    if (seen.has(d)) continue;
    let from = d, to = d;
    while (away(addDays(from, -1))) from = addDays(from, -1);
    while (away(addDays(to, 1))) to = addDays(to, 1);
    for (let x = from; x <= to; x = addDays(x, 1)) seen.add(x);
    best = Math.max(best, daysBetween(from, to).length);
  }
  return best;
}

export function noticeNeeded(stretch: number, r: Rules): number {
  const s = Math.max(1, stretch);
  return s <= r.b1Len ? r.b1Days : s <= r.b2Len ? r.b2Days : r.b3Days;
}
/** Calendar days from the day of applying to the first day of leave. */
export function noticeGiven(startDate: string, appliedDate: string): number {
  return Math.round((Date.parse(startDate + 'T00:00:00Z') - Date.parse(appliedDate + 'T00:00:00Z')) / 86400000);
}

export type Level = 'tl' | 'admin';
export interface FullHalf { day: string; half: 'first' | 'second'; count: number; limit: number }

export type Decision =
  | { outcome: 'auto_approve'; why: string }
  | { outcome: 'route'; level: Level; why: string }
  | { outcome: 'reject'; code: 'short_notice' | 'full' | 'too_long'; note: string };

export interface DecideInput {
  rules: Rules; stretch: number; leave: number; lop: number;
  startDate: string; appliedDate: string; applicantHasTl: boolean; fullHalves: FullHalf[];
  fmtDay?: (iso: string) => string;
}

/** Who decides the stretch: above threshold 2 an admin, above threshold 1 the TL (an admin when the person has no TL). */
export function levelForStretch(stretch: number, r: Rules, applicantHasTl: boolean): Level | null {
  if (stretch > r.threshold2) return 'admin';
  if (stretch > r.threshold1) return applicantHasTl ? 'tl' : 'admin';
  return null;
}

/**
 * The order of the rules: short notice, a full day, too long. Then who decides. The stricter rule wins, so a request for
 * today (the leave day counts as after the date) or one above threshold 2 goes to an admin. Part LOP always needs a person.
 */
export function decide(i: DecideInput): Decision {
  const fd = i.fmtDay ?? ((d: string) => d);
  const needed = noticeNeeded(i.stretch, i.rules), given = noticeGiven(i.startDate, i.appliedDate);
  if (i.leave > 0 && given < needed) {
    return { outcome: 'reject', code: 'short_notice', note: `${i.stretch > 1 ? `Being away ${i.stretch} days in a row` : 'This leave'} needs ${needed} day${needed === 1 ? '' : 's'} notice and you gave ${given}` };
  }
  if (i.fullHalves.length) {
    const w = [...i.fullHalves].sort((a, b) => b.count - a.count || a.day.localeCompare(b.day))[0];
    return { outcome: 'reject', code: 'full', note: `${w.count} ${w.count === 1 ? 'person is' : 'people are'} already off on ${fd(w.day)}${w.half ? `, ${w.half} half` : ''}` };
  }
  if (i.stretch > i.rules.maxLength) {
    return { outcome: 'reject', code: 'too_long', note: `${i.stretch} days away in a row is longer than the maximum of ${i.rules.maxLength}` };
  }
  const byStretch = levelForStretch(i.stretch, i.rules, i.applicantHasTl);
  const onOrAfterDate = i.startDate <= i.appliedDate;
  let level: Level | null = byStretch;
  let why = '';
  if (byStretch) why = byStretch === 'admin' && i.stretch > i.rules.threshold2 ? `${i.stretch} days away in a row is above ${i.rules.threshold2}: needs an admin` : i.stretch > i.rules.threshold1 ? `${i.stretch} days away in a row is above ${i.rules.threshold1}: needs ${byStretch === 'tl' ? 'your TL' : 'an admin'}` : '';
  if (i.lop > 0) { level = level ?? (i.applicantHasTl ? 'tl' : 'admin'); why = why || 'Part of it is LOP, which always needs a person to approve'; }
  if (onOrAfterDate) { level = 'admin'; why = 'The leave starts today, so only an admin can decide it'; }
  if (level === null) return { outcome: 'auto_approve', why: `${Math.max(1, i.stretch)} day${i.stretch > 1 ? 's' : ''} away in a row, up to ${i.rules.threshold1}: the system approves it` };
  return { outcome: 'route', level, why };
}

export interface Approver { userId: number; role: string; isTlOfApplicant: boolean }
export interface WaitingRequest { applicantUserId: number; withLevel: Level; sentToTl: boolean; fullDay: boolean; stretch: number; startDate: string; today: string; lop: number }
export interface Actions { approve: boolean; reject: boolean; forward: boolean; approveBlockedWhy?: string; needsOverLimitOk?: boolean }

/**
 * What an approver may do with a waiting request. Nobody acts on their own request. An admin can do anything first. A TL can
 * reject or forward their team's requests, and approve only what the rules leave at the TL level: not a full day, not a
 * request the system rejected and the person sent up, not one that has grown past the TL's level or starts today.
 */
export function actionsFor(who: Approver, w: WaitingRequest, rules: Rules, applicantHasTl: boolean): Actions {
  if (who.userId === w.applicantUserId) return { approve: false, reject: false, forward: false };
  if (who.role === 'admin') return { approve: true, reject: true, forward: false, needsOverLimitOk: w.fullDay };
  if (who.role !== 'tl' || !who.isTlOfApplicant) return { approve: false, reject: false, forward: false };
  const level = levelForStretch(w.stretch, rules, applicantHasTl);
  let why: string | undefined;
  if (w.fullDay) why = 'Limit crossed for this day. Please reach out to your Sr TL.';
  else if (w.sentToTl) why = 'The system rejected this and it was sent to you. Only an admin can approve it. You can reject it or forward it.';
  else if (level === 'admin' || w.startDate <= w.today) why = 'This needs an admin. You can forward it or reject it.';
  return { approve: !why, reject: true, forward: true, approveBlockedWhy: why };
}
