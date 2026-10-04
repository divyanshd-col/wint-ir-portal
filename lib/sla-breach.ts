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
  status: string;
  created_at: Date;
  first_response_at: Date | null;
  updated_at: Date;
}

export interface BreachingTicket {
  chat_id: string;
  ticket_id: string;
  customer_email: string | null;
  customer_phone: string | null;
  user_last_replied_at: Date;
  sla_breach_time: Date;
}

export const SLA_HOURS = 24;

/**
 * SLA clock anchor. Approximation: there is no "customer's last message" column, so once a
 * first response exists we fall back to updated_at, which moves on ANY row change.
 */
export function slaClockStart(r: Pick<EmailTicketRow, 'created_at' | 'first_response_at' | 'updated_at'>): Date {
  return r.first_response_at == null ? r.created_at : r.updated_at;
}

/** In-memory equivalent of the production SQL: OPEN tickets whose anchor + 24h falls in the window. */
export function findBreachingTickets(
  rows: EmailTicketRow[],
  { windowStart, windowEnd }: { windowStart: Date; windowEnd: Date },
): BreachingTicket[] {
  return rows
    .filter((r) => r.status === 'OPEN')
    .map((r) => {
      const anchor = slaClockStart(r);
      return {
        chat_id: r.chat_id,
        ticket_id: r.id,
        customer_email: r.customer_email,
        customer_phone: r.customer_phone,
        user_last_replied_at: anchor,
        sla_breach_time: new Date(anchor.getTime() + SLA_HOURS * HOUR_MS),
      };
    })
    .filter((t) => t.sla_breach_time >= windowStart && t.sla_breach_time <= windowEnd)
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

/** "2h 43m", "8m", "1d 9h", or "overdue" — time left until the breach. */
export function formatBreachesIn(breach: Date, now: Date): string {
  const mins = Math.floor((breach.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'overdue';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
    const text = `No SLA breaches expected in the ${windowLabel} window. ✅${excludedNote}`;
    return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
  }
  const shown = rows.slice(0, MAX_TABLE_DATA_ROWS);
  const header = `${mentions} *SLA breach alert* — ${rows.length} ticket(s) breaching in the ${windowLabel} window${excludedNote}`;
  const cell = (text: string) => ({ type: 'raw_text', text });
  const table = {
    type: 'table',
    rows: [
      [cell('Ticket ID'), cell('Breaches in'), cell('Breaches at'), cell('Open ticket')],
      ...shown.map((r) => [
        cell(r.chat_id),
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
  fetchRows: (window: { windowStart: Date; windowEnd: Date }) => Promise<BreachingTicket[]>;
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
  const { human, automatedCount } = splitAutomated(await d.fetchRows(getSlaWindow(d.now, t)));
  await d.post(buildSlackPayload(human, WINDOW_LABELS[t], d.now, formatMentions(d.mentions), automatedCount));
  return { status: 200, body: { ok: true, count: human.length, excluded: automatedCount } };
}
