export type SlaTrigger = 1 | 2;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** SLA breach window (as UTC instants) for a cron trigger, anchored on the IST calendar day of `now`. */
export function getSlaWindow(now: Date, trigger: SlaTrigger): { windowStart: Date; windowEnd: Date } {
  const istMidnightUtcMs =
    Math.floor((now.getTime() + IST_OFFSET_MS) / (24 * HOUR_MS)) * 24 * HOUR_MS - IST_OFFSET_MS;
  const [startH, endH] = trigger === 1 ? [10, 19] : [19, 24 + 11.5];
  return {
    windowStart: new Date(istMidnightUtcMs + startH * HOUR_MS),
    windowEnd: new Date(istMidnightUtcMs + endH * HOUR_MS),
  };
}

export interface EmailTicketRow {
  id: string;
  chat_id: string;
  customer_email: string | null;
  customer_phone: string | null;
  created_at: Date;
  first_response_at: Date | null;
  intent_l1?: string | null;
  /** Latest "ticket_source_rb_em" property: "Email" (customer wrote in) or "Portal" (an agent opened the ticket and sent the first email). */
  ticket_source?: string | null;
  /** Any Robylon webhook event is stored for this ticket. Tickets without one (older than event capture) cannot be judged and are skipped. */
  has_events: boolean;
  /** Latest Robylon status (STATUS_CHANGED new_status), e.g. "Answered". null: no status event yet, treated as Open. */
  robylon_status: string | null;
  /** Any incoming message is stored for the ticket (customer or Wint sender). The first email then comes from the message events, not created_at. */
  has_incoming_message: boolean;
  /** Latest message from the customer (incoming, sender not @wintwealth.com). */
  last_customer_message_at: Date | null;
  /** Latest agent message: a reply sent, or an incoming mail from a @wintwealth.com address (internal forward). Internal notes are not messages. */
  last_agent_message_at: Date | null;
  /** When the ticket was last moved to a status that means the agent acted (Answered / Pending email sent). */
  last_agent_status_at: Date | null;
}

export interface BreachingTicket {
  chat_id: string;
  ticket_id: string;
  customer_email: string | null;
  customer_phone: string | null;
  intent_l1?: string | null;
  user_last_replied_at: Date;
  sla_breach_time: Date;
  /** The 24h deadline has already passed and the customer is still waiting. */
  overdue: boolean;
}

export const SLA_HOURS = 24;

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Robylon statuses the SLA applies to. Everything else (Hold, Entity Escalation, WAITING_ON_AGENT, Repayment*, CLOSED) is ignored.
 *  "Customer reponded" is Robylon's own spelling. */
const IN_SCOPE_STATUSES = new Set([
  'open', 'pending', 'customer reponded', 'customer responded', 'pending email sent', 'answered', 'internal dependency', 'external dependency',
]);

export function isInScopeStatus(status: string | null | undefined): boolean {
  return IN_SCOPE_STATUSES.has(norm(status));
}

/** Statuses that mean an agent acted. A customer message newer than the status change still wins: it is the safeguard for
 *  tickets Robylon failed to move back to "Customer responded". */
const AGENT_ACTION_STATUSES = new Set(['answered', 'pending email sent']);
export const isAgentActionStatus = (status: string | null | undefined) => AGENT_ACTION_STATUSES.has(norm(status));

const latest = (...ds: (Date | null | undefined)[]): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

/** When the customer last spoke: their newest message. A ticket with no stored incoming message at all uses its creation time (the first email),
 *  unless it was opened from the Portal (we wrote first). null when the only incoming mail came from a Wint address (an internal ticket): nobody outside is waiting. */
export function customerClock(r: Pick<EmailTicketRow, 'created_at' | 'has_incoming_message' | 'last_customer_message_at' | 'ticket_source'>): Date | null {
  if (r.last_customer_message_at) return r.last_customer_message_at;
  if (r.has_incoming_message) return null;
  // Portal tickets start with our own outbound email: the customer has not spoken, so there is no clock until they reply.
  return norm(r.ticket_source) === 'portal' ? null : r.created_at;
}

/** When an agent last acted: newest reply, forwarded mail from a Wint address, first response, or an Answered / Pending email sent status. */
export function agentLastAction(r: Pick<EmailTicketRow, 'first_response_at' | 'last_agent_message_at' | 'last_agent_status_at'>): Date | null {
  return latest(r.first_response_at, r.last_agent_message_at, r.last_agent_status_at);
}

/** True for Wint staff senders: the last message came from our side, so the ball is in the customer's court. */
export function isStaffEmail(email: string | null | undefined): boolean {
  return /@wintwealth\.com$/i.test((email ?? '').trim());
}

/** A ticket needs an agent when it is in scope and the customer spoke after the agent's last action (or the agent never acted). */
export function isWaitingOnAgent(r: EmailTicketRow): boolean {
  if (!r.has_events) return false;
  if (r.robylon_status != null && !isInScopeStatus(r.robylon_status)) return false;
  const customer = customerClock(r);
  if (customer == null) return false;
  const agent = agentLastAction(r);
  return agent == null || customer > agent;
}

/**
 * Tickets still waiting on an agent whose SLA (customer's last message + 24h) has already passed (overdue),
 * or breaches inside the window (upcoming). Overdue tickets come first, oldest breach first.
 */
export function findBreachingTickets(
  rows: EmailTicketRow[],
  { windowStart, windowEnd }: { windowStart: Date; windowEnd: Date },
  now: Date,
): BreachingTicket[] {
  return rows
    .filter(isWaitingOnAgent)
    .map((r) => {
      const anchor = customerClock(r)!; // isWaitingOnAgent guarantees a customer clock
      const breach = new Date(anchor.getTime() + SLA_HOURS * HOUR_MS);
      return {
        chat_id: r.chat_id,
        ticket_id: r.id,
        customer_email: r.customer_email,
        customer_phone: r.customer_phone,
        intent_l1: r.intent_l1 ?? null,
        user_last_replied_at: anchor,
        sla_breach_time: breach,
        overdue: breach < now,
      };
    })
    .filter((t) => t.overdue || (t.sla_breach_time >= windowStart && t.sla_breach_time <= windowEnd))
    .sort((a, b) => a.sla_breach_time.getTime() - b.sla_breach_time.getTime());
}

export const WINDOW_LABELS: Record<SlaTrigger, string> = {
  1: '10 AM to 7 PM today',
  2: '7 PM today to 11:30 AM tomorrow',
};

export const ticketUrl = (chatId: string) => `https://app.robylon.ai/unified-inbox/share/${chatId}`;

export interface SlackPayload {
  text: string;
  blocks?: Record<string, unknown>[];
}

/** "2h 43m", "8m", "1d 9h": a duration in minutes, whole minutes, no seconds. */
function formatDuration(mins: number): string {
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Time left until the breach ("2h 43m"), or "overdue 1d 9h" once the deadline has passed ("overdue" within the first minute). */
export function formatBreachesIn(breach: Date, now: Date): string {
  const mins = Math.floor((breach.getTime() - now.getTime()) / 60000);
  if (mins > 0) return formatDuration(mins);
  const late = Math.floor((now.getTime() - breach.getTime()) / 60000);
  return late >= 1 ? `overdue ${formatDuration(late)}` : 'overdue';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L1 intent name for display, or null when Robylon has not classified the ticket ("None", empty, or a raw id). */
export function cleanIntent(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return !t || t.toLowerCase() === 'none' || UUID.test(t) ? null : t;
}

/** Breach time in IST, e.g. "1 Oct, 7:04 PM". */
export function formatBreachesAt(breach: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(breach);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('day')} ${g('month')}, ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`;
}

/** Comma-separated Slack IDs → mention string. S… = user group, U…/W… = user. Falls back to plain text (does not ping). */
export function formatMentions(ids: string | undefined): string {
  const parts = (ids ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return '@cx_tl @email';
  return parts.map((id) => (id.startsWith('S') ? `<!subteam^${id}>` : `<@${id}>`)).join(' ');
}

// Local-part patterns for senders that never need a human reply. Kept short and explicit on purpose.
const AUTOMATED_LOCAL_PART = /no[-_.]?reply|do[-_.]?not[-_.]?reply|^(notifications?|mailer-daemon|postmaster|bounces?|recommendations|newsletters?)$/i;

export function isAutomatedSender(email: string | null | undefined): boolean {
  if (!email) return false;
  return AUTOMATED_LOCAL_PART.test(email.split('@')[0].trim());
}

export function splitAutomated(rows: BreachingTicket[]): { human: BreachingTicket[]; automatedCount: number } {
  const human = rows.filter((r) => !isAutomatedSender(r.customer_email));
  return { human, automatedCount: rows.length - human.length };
}

const MAX_TABLE_DATA_ROWS = 99; // Slack table block: 100 rows incl. header

export function buildSlackPayload(
  rows: BreachingTicket[],
  windowLabel: string,
  now: Date,
  mentions: string,
  excluded = 0,
): SlackPayload {
  const excludedNote = excluded > 0 ? ` (${excluded} automated sender(s) excluded)` : '';
  if (rows.length === 0) {
    const text = `No overdue tickets and no SLA breaches expected in the ${windowLabel} window. ✅${excludedNote}`;
    return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
  }
  const shown = rows.slice(0, MAX_TABLE_DATA_ROWS);
  const overdue = rows.filter((r) => r.overdue).length;
  const upcoming = rows.length - overdue;
  const counts = [
    overdue > 0 ? `${overdue} overdue (customer still waiting)` : '',
    upcoming > 0 ? `${upcoming} breaching in the ${windowLabel} window` : '',
  ].filter(Boolean).join(', ');
  const header = `${mentions} *SLA breach alert* — ${counts}${excludedNote}`;
  const cell = (text: string) => ({ type: 'raw_text', text });
  const table = {
    type: 'table',
    rows: [
      [cell('Ticket ID'), cell('Category'), cell('Breaches in'), cell('Breaches at'), cell('Open ticket')],
      ...shown.map((r) => [
        cell(r.chat_id),
        cell(cleanIntent(r.intent_l1) ?? '—'),
        cell(formatBreachesIn(r.sla_breach_time, now)),
        cell(formatBreachesAt(r.sla_breach_time)),
        {
          type: 'rich_text',
          elements: [{
            type: 'rich_text_section',
            elements: [{ type: 'link', url: ticketUrl(r.chat_id), text: 'Open ticket' }],
          }],
        },
      ]),
    ],
  };
  const blocks: Record<string, unknown>[] = [{ type: 'section', text: { type: 'mrkdwn', text: header } }, table];
  if (rows.length > shown.length) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `…and ${rows.length - shown.length} more not shown` }] });
  }
  return { text: header, blocks };
}

export interface CronResult {
  status: number;
  body: Record<string, unknown>;
}

export interface CronDeps {
  authHeader: string | null;
  secret: string | undefined;
  trigger: string | null;
  now: Date;
  fetchOpenTickets: () => Promise<EmailTicketRow[]>;
  mentions?: string;
  post: (payload: SlackPayload) => Promise<void>;
}

/** Cron orchestration with injected I/O. Auth is checked first and fails closed if no secret is configured. */
export async function runSlaBreachCron(d: CronDeps): Promise<CronResult> {
  if (!d.secret || d.authHeader !== `Bearer ${d.secret}`) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const trigger = d.trigger ?? '1';
  if (trigger !== '1' && trigger !== '2') {
    return { status: 400, body: { error: 'trigger must be 1 or 2' } };
  }
  const t = Number(trigger) as SlaTrigger;
  const breaching = findBreachingTickets(await d.fetchOpenTickets(), getSlaWindow(d.now, t), d.now);
  const { human, automatedCount } = splitAutomated(breaching);
  await d.post(buildSlackPayload(human, WINDOW_LABELS[t], d.now, formatMentions(d.mentions), automatedCount));
  return { status: 200, body: { ok: true, count: human.length, excluded: automatedCount } };
}
