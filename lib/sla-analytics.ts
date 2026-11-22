/**
 * Email SLA / TAT analytics (admin). Pure rules, no database: lib/sla-analytics-db.ts gathers one row per customer email,
 * this file decides what counts and how it is summarised.
 *
 * Rules (agreed with the team):
 *  - Every customer email gets its own 24h clock, from when it reached us to the first agent reply after it.
 *    A breach is a reply later than 24h, or no reply 24h on.
 *  - A customer email is an incoming message from a non-@wintwealth.com sender. Tickets an agent starts (an outbound mail, ticket
 *    source "Portal") have no customer email until the customer writes back, so they never count as a breach on their own.
 *  - The agent's response is the first reply, internal forward or other agent message after the email (internal notes excluded; see
 *    lib/sla-analytics-db.ts). No such message, but the ticket was moved to Answered / Pending email sent after the email: that status
 *    time is the reply time.
 *  - Tickets whose latest Robylon status is Repayment*, Hold, WAITING_ON_AGENT or Entity Escalation are left out (same as the alert).
 *  - A customer email with no reply on a ticket that is now Closed/Resolved ("closed after customer responded", mostly a closing
 *    "thanks") is left out unless the caller asks for it.
 */
export const SLA_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/** 1 Oct 2026 00:00 IST. Events are only captured from 28 Sep, and the team asked to start on 1 Oct. */
export const SLA_ANALYTICS_START = new Date('2026-09-30T18:30:00.000Z');

const IGNORED_STATUSES = new Set(['repayment', 'repayment external dependency', 'hold', 'waiting_on_agent', 'entity escalation']);

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** One customer email and what happened to it. */
export interface SlaEmailRow {
  chat_id: string;
  ticket_id: string;
  customer_at: Date;
  /** First agent reply after the email, or null. */
  replied_at: Date | null;
  /** First internal note after the email, or null. Not a response (the email still counts as unanswered); shown so the team can see why. */
  noted_at: Date | null;
  /** Latest Robylon status (STATUS_CHANGED new_status), null when the ticket has none. */
  robylon_status: string | null;
  /** Unanswered emails only: when Robylon last sent us anything for the ticket. */
  last_event_at?: Date | null;
  /** Unanswered emails only: agent messages Robylon counts that we never received (a missed webhook). 0 when none. */
  missing_agent_messages?: number;
  /** 'CLOSED' when the webhook log has a TICKET_CLOSED event after the customer's last message (the ticket was not reopened), else null. Fallback for tickets with no status event. */
  ticket_status: string | null;
}

export interface SlaBreach {
  chatId: string;
  ticketId: string;
  customerAt: string;
  repliedAt: string | null;
  /** Internal note added after the email when there is no reply ("Note added"), else null. */
  noteAt: string | null;
  /** No-reply rows: last Robylon update for the ticket, so stale data is visible. */
  lastEventAt: string | null;
  /** No-reply rows: agent messages Robylon counts that never reached us. The reply may exist; check Robylon. */
  missingAgentMessages: number;
  /** Hours past the 24h deadline: at reply time, or until now when there is no reply. */
  hoursLate: number;
  status: string | null;
  closedAfterCustomer: boolean;
}

export interface SlaSummary {
  emailsReceived: number;
  /** Replied within 24h as a share of emails whose 24h has ended or that were replied to. null when there are none yet. */
  repliedWithinPct: number | null;
  breaches: number;
  lateReplies: number;
  avgTatHours: number | null;
  medianTatHours: number | null;
  /** Unanswered, past the deadline, and the ticket is still open. Closed-after-customer-responded emails are not "waiting". */
  unansweredPast24h: number;
}

export function isIgnoredStatus(status: string | null | undefined): boolean {
  return IGNORED_STATUSES.has(norm(status));
}

/** Closed or Resolved. The latest Robylon status wins; the TICKET_CLOSED event (ticket_status) is the fallback when there is none. */
export function isClosedTicket(r: Pick<SlaEmailRow, 'robylon_status' | 'ticket_status'>): boolean {
  if (norm(r.robylon_status)) return norm(r.robylon_status) === 'closed';
  return ['closed', 'resolved'].includes(norm(r.ticket_status));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function analyzeSla(
  rows: SlaEmailRow[],
  now: Date,
  { includeClosedUnreplied = false }: { includeClosedUnreplied?: boolean } = {},
): { summary: SlaSummary; breaches: SlaBreach[] } {
  const breaches: SlaBreach[] = [];
  const tats: number[] = [];
  let received = 0, within = 0, late = 0, unanswered = 0, unansweredWaiting = 0;

  for (const r of rows) {
    if (isIgnoredStatus(r.robylon_status)) continue;
    const closed = isClosedTicket(r);
    if (!r.replied_at && closed && !includeClosedUnreplied) continue;

    received++;
    const deadline = r.customer_at.getTime() + SLA_HOURS * HOUR_MS;
    const row = { chatId: r.chat_id, ticketId: r.ticket_id, customerAt: r.customer_at.toISOString(), status: r.robylon_status, closedAfterCustomer: !r.replied_at && closed };

    if (r.replied_at) {
      tats.push((r.replied_at.getTime() - r.customer_at.getTime()) / HOUR_MS);
      if (r.replied_at.getTime() <= deadline) { within++; continue; }
      late++;
      breaches.push({ ...row, repliedAt: r.replied_at.toISOString(), noteAt: null, lastEventAt: null, missingAgentMessages: 0, hoursLate: round1((r.replied_at.getTime() - deadline) / HOUR_MS) });
    } else if (now.getTime() > deadline) {
      unanswered++;
      if (!closed) unansweredWaiting++;
      breaches.push({ ...row, repliedAt: null, noteAt: r.noted_at ? r.noted_at.toISOString() : null,
        lastEventAt: r.last_event_at ? r.last_event_at.toISOString() : null, missingAgentMessages: r.missing_agent_messages ?? 0, hoursLate: round1((now.getTime() - deadline) / HOUR_MS) });
    }
    // else: no reply yet but still inside the 24h, nothing to judge
  }

  const sorted = [...tats].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const judged = within + late + unanswered;

  return {
    summary: {
      emailsReceived: received,
      repliedWithinPct: judged ? Math.round((within / judged) * 1000) / 10 : null,
      breaches: late + unanswered,
      lateReplies: late,
      avgTatHours: tats.length ? round1(tats.reduce((a, b) => a + b, 0) / tats.length) : null,
      medianTatHours: median === null ? null : round1(median),
      unansweredPast24h: unansweredWaiting,
    },
    // worst first
    breaches: breaches.sort((a, b) => b.hoursLate - a.hoursLate),
  };
}

/** Day boundaries in IST, as the rest of the portal does (`from` 00:00 to the end of `to`). Clamped to the 1 Oct start. */
export function parseSlaRange(from: string | null, to: string | null, now: Date): { from: Date; to: Date } {
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+05:30`) : null);
  const f = day(from);
  const t = day(to);
  const end = t && !isNaN(t.getTime()) ? new Date(t.getTime() + 24 * HOUR_MS) : new Date(now.getTime() + 1);
  const start = f && !isNaN(f.getTime()) ? f : new Date(end.getTime() - 7 * 24 * HOUR_MS);
  return { from: start < SLA_ANALYTICS_START ? SLA_ANALYTICS_START : start, to: end };
}
