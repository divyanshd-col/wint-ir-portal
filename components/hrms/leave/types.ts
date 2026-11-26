export type Half = 'full' | 'first' | 'second';
export interface ReqBrief { leave_id: string; start_date: string; end_date: string; start_half: Half; end_half: Half; days: number }
export interface Me {
  userId: number; ready: boolean; rulesReady: boolean; rulesMissing: string[]; negativeLimit: number; today: string;
  person: { name: string; role: string }; roster: { type: number | null; label: string | null; offWeekdays: number[] };
  balance: number; held: number; available: number;
  upcoming: (ReqBrief & { status: string })[];
  inProcess: (ReqBrief & { window_ends_at: string })[];
  needsAction: { leave_id: string; start_date: string; end_date: string; start_half?: Half; end_half?: Half; reject_note: string | null; reject_code?: string | null; cancel_deadline: string }[];
  lopMonth: { label: string; approved: number; waiting: number };
  nextCredit: { date: string; amount: number | null };
  holidays: { day: string; name: string }[];
  scheduled: { type: number; label: string | null; starts_on: string; set_by: string | null } | null;
  can: { use: boolean; approve: boolean };
}
export interface PreviewData {
  days: { day: string; half: Half; weight: number }[]; leave: number; lop: number; stretch: number; run: { from: string; to: string } | null; runParts: { from: string; to: string; label: string }[];
  noticeNeeded: number; noticeGiven: number; outcome: 'auto_approve' | 'route' | 'reject'; deciderText: string; why: string; balance: number; held: number; available: number; balanceAfter: number;
  fullHalves: { day: string; half: 'first' | 'second'; count: number; limit: number }[]; lopWarning: string | null; rejectCode: 'short_notice' | 'full' | 'too_long' | null; tooLong: boolean; maxLength: number;
}
export interface CalendarDay {
  day: string; off: boolean; hasType: boolean; holiday: string | null;
  mine: { kind: 'leave' | 'lop' | 'pend' | 'taken'; halves: [boolean, boolean]; leaveId: string } | null; full: [boolean, boolean];
}
