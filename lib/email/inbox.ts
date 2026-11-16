/**
 * Which inbox a Robylon email event was sent to, and which inboxes belong to PCG.
 *
 * Robylon posts every email event, CX and PCG, to /api/webhooks/email. The route tells them apart by inbox: an event from an inbox
 * listed in Settings → PCG → Email Inbox is stored in pcg_webhook_payloads and skips all CX processing; everything else is CX.
 * The list is `pcgEmailInboxes` in the portal config. Until an admin saves one, the built-in default below applies, so routing works from
 * the first deploy; a saved list (even an empty one) replaces the default.
 *
 * The rules are pure (unit-tested offline); the config and DB helpers import their dependencies lazily.
 */

/** Robylon property holding the inbox address on a ticket's events. */
const INBOX_PROPERTY = 'ticket_channel_email_rb_em';

/** PCG's inboxes, used until an admin saves a list in Settings → PCG → Email Inbox. */
export const DEFAULT_PCG_EMAIL_INBOXES: string[] = ['hnidesk@wintwealth.com', 'pmsadvisory@wintwealth.com', 'huf@wintwealth.com'];

export const normalizeInbox = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * The inbox an event was sent to: `channel_info.email` (top level, present on about 97% of recent events), else the
 * `ticket_channel_email_rb_em` property in `data.properties` (present on every TICKET_CREATED, REPLY_SENT, STATUS_CHANGED and
 * TICKET_CLOSED). null when neither is there (some NEW_MESSAGE / INTERNAL_NOTE_ADDED events): the caller looks the ticket up.
 */
export function emailInboxOf(payload: any): string | null {
  const fromChannel = normalizeInbox(payload?.channel_info?.email);
  if (fromChannel.includes('@')) return fromChannel;
  const props = Array.isArray(payload?.data?.properties) ? payload.data.properties : Array.isArray(payload?.properties) ? payload.properties : [];
  const p = props.find((x: any) => x?.name === INBOX_PROPERTY);
  const fromProp = normalizeInbox(p?.snapshot_value || p?.selected_value);
  return fromProp.includes('@') ? fromProp : null;
}

export const isPcgInbox = (inbox: string | null, pcgInboxes: string[]): boolean => Boolean(inbox) && pcgInboxes.includes(inbox as string);

const MAX_INBOXES = 20;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Validates a saved-settings payload: a list (or a text of addresses split by lines, commas or semicolons). Lower-cased, de-duplicated. */
export function parsePcgEmailInboxes(input: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,;]+/) : null;
  if (!raw) return { ok: false, error: 'pcgEmailInboxes must be a list of email addresses' };
  const out: string[] = [];
  for (const r of raw) {
    const v = normalizeInbox(r);
    if (!v) continue;
    if (!EMAIL.test(v)) return { ok: false, error: `"${String(r).trim()}" is not a valid email address` };
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > MAX_INBOXES) return { ok: false, error: `At most ${MAX_INBOXES} inboxes` };
  return { ok: true, value: out };
}

/** Share of recent CX tickets that arrived in each inbox: { 'a@x.com': 0.97, ... }. Input: one inbox string per ticket. */
export function inboxShares(inboxes: (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const i of inboxes) { if (!i) continue; counts[i] = (counts[i] ?? 0) + 1; total++; }
  return Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / total]));
}

/** Routing an inbox to PCG that carries this much of the CX traffic would move CX emails out of CX: refuse it when saving. */
export const CX_INBOX_SHARE_LIMIT = 0.5;

/** The effective PCG inbox list from a config object: the saved list (an empty one means none), else the built-in default. */
export function pcgInboxesOf(config: object | null | undefined): string[] {
  const list = (config as { pcgEmailInboxes?: unknown } | null | undefined)?.pcgEmailInboxes;
  return Array.isArray(list) ? list.map(normalizeInbox).filter(Boolean) : [...DEFAULT_PCG_EMAIL_INBOXES];
}

/** The PCG inbox list from the portal config. A config that cannot be read throws, so the webhook answers 5xx and Robylon retries
 *  (treating it as "no PCG inboxes" would quietly send PCG emails through the CX pipeline). */
export async function getPcgEmailInboxes(): Promise<string[]> {
  const { readConfig } = await import('@/lib/config');
  return pcgInboxesOf(await readConfig());
}

/** Share (0 to 1) of the CX tickets created in the last 7 days that arrived in `inbox`, from the stored CX webhook events. */
export async function cxShareOfInbox(inbox: string): Promise<number> {
  const { query } = await import('@/lib/cx/db');
  const rows = await query<{ inbox: string | null }>(
    `SELECT lower(COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value')) AS inbox
     FROM robylon_webhook_payloads w,
          jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
     WHERE w.source = 'email' AND w.event_type = 'TICKET_CREATED'
       AND w.received_at > now() - interval '7 days' AND p->>'name' = '${INBOX_PROPERTY}'`,
  );
  return inboxShares(rows.map(r => r.inbox))[normalizeInbox(inbox)] ?? 0;
}
