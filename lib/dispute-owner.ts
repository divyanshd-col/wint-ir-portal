import type { IQSFlag } from '@/lib/store';
// The rules below are pure (unit-tested offline); the DB-backed helpers import their dependencies lazily.

/**
 * Who resolves CX disputes (chats, calls, emails; PCG is a separate flow and never reads this).
 *  - 'qa' (default, nothing saved): the old flow. IR raises, the TL forwards to QA, QA edits the scores.
 *  - 'tl': IR disputes are reviewed and resolved by the TL of the agent. QA only audits what falls at or below the review threshold.
 * An admin switches it in Settings → Quality Thresholds → Dispute owner (saved in the portal config, change history recorded).
 * Nothing in the data changes with the switch, so switching back is safe.
 *
 * TL-raised disputes always stay with QA: a TL cannot resolve a dispute they raised themselves.
 */
export type DisputeOwner = 'qa' | 'tl';

/** Validates a saved-settings payload. */
export function parseDisputeOwner(input: unknown): { ok: true; value: DisputeOwner } | { ok: false; error: string } {
  return input === 'qa' || input === 'tl' ? { ok: true, value: input } : { ok: false, error: "disputeOwner must be 'qa' or 'tl'" };
}

/** The saved owner from any object that may carry `disputeOwner` (the portal config). Anything but 'tl' means QA. */
export const disputeOwnerOf = (config: object | null | undefined): DisputeOwner =>
  (config as { disputeOwner?: unknown } | null | undefined)?.disputeOwner === 'tl' ? 'tl' : 'qa';

/** Current owner, from the portal config. A config that cannot be read means QA (the old flow). */
export async function getDisputeOwner(): Promise<DisputeOwner> {
  const { readConfig } = await import('@/lib/config');
  return disputeOwnerOf(await readConfig().catch(() => null));
}
export const disputesOwnedByTL = async () => (await getDisputeOwner()) === 'tl';

const OPEN_STATUSES = ['pending', 'ir_pending_tl', 'tl_forwarded'];

/** True when this flag is in the TL's queue: TLs own disputes, it was raised by IR (not a TL), and nobody has decided it yet.
 *  Includes 'tl_forwarded' so disputes already sitting with QA at the switch move to the TL. */
export const isTlActionable = (f: Pick<IQSFlag, 'status' | 'raisedByRole'>, owner: DisputeOwner) =>
  owner === 'tl' && f.raisedByRole !== 'tl' && OPEN_STATUSES.includes(f.status);

type Denial = { status: number; error: string };

/** Only signed-in admins, QA and TLs may change an email's scores or decide its dispute (agents raise disputes, they never review). */
export function emailReviewDenial(user: { role?: string; isAdmin?: boolean } | null | undefined): Denial | null {
  if (!user) return { status: 401, error: 'Unauthorized' };
  const role = user.role || (user.isAdmin ? 'admin' : '');
  return ['admin', 'quality', 'tl'].includes(role) ? null : { status: 403, error: 'Forbidden' };
}

/** Rules for a TL changing an email's scores or deciding its dispute. Null when allowed (always for admin / QA). */
export function tlEmailDenial(o: {
  role: string; owner: DisputeOwner; email: string; inTeam: boolean;
  disputeStatus: string | null | undefined; flagRaisedByRole?: string | null; flagAgentEmail?: string | null;
}): Denial | null {
  if (o.role !== 'tl') return null;
  if (o.owner !== 'tl') return { status: 403, error: 'Disputes are resolved by QA' };
  if (!['Raised', 'Under_Review'].includes(o.disputeStatus ?? '')) return { status: 409, error: 'A TL can only change scores to resolve an open dispute' };
  if (o.flagRaisedByRole === 'tl' || (o.flagAgentEmail || '').toLowerCase() === o.email.toLowerCase()) return { status: 403, error: 'You cannot resolve a dispute you raised' };
  if (!o.inTeam) return { status: 403, error: 'Forbidden: You can only resolve disputes for your assigned agents' };
  return null;
}

/** Same prefix / full-name match the TL dispute list always used (Robylon names and portal names differ by a surname). */
export function agentInTeam(teamAgents: string[], agentName: string | null | undefined): boolean {
  const n = (agentName ?? '').trim().toLowerCase();
  if (!n) return false;
  return teamAgents.some((a) => {
    const t = a.trim().toLowerCase();
    return t === n || t.startsWith(n + ' ') || n.startsWith(t + ' ');
  });
}

/**
 * Status for the score row after a TL edit. QA audits chats, calls and emails whose score is at or below the review threshold
 * (the QA queues only list 'pending' / 'reopened'), so a TL edit must not mark those 'reviewed' or they drop out of the audit.
 * An item QA already reviewed stays reviewed. `forceAudit` is for calls that failed a critical gate (QA audits those at any score).
 */
export function tlEditStatus(
  iqs: number | null | undefined,
  threshold: number,
  currentStatus: string | null | undefined,
  forceAudit = false,
): string {
  const inQaQueue = currentStatus === 'pending' || currentStatus === 'reopened';
  const audit = forceAudit || (iqs != null && iqs <= threshold);
  return inQaQueue && audit ? (currentStatus as string) : 'reviewed';
}

/** Agents under this TL (the same lookup the TL dispute list uses). Admins are not scoped. */
export async function getTlAgentNames(email: string): Promise<string[]> {
  const [{ readConfig }, { getAgentNamesByTL }] = await Promise.all([import('@/lib/config'), import('@/lib/robylon/db')]);
  const config = await readConfig();
  const configUser = config.users.find((u) => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
  let tlName = configUser?.agentName;
  if (!tlName && email) {
    const { getUserByEmail } = await import('@/lib/users');
    const dbUser = await getUserByEmail(email).catch(() => null);
    if (dbUser?.name) tlName = dbUser.name;
  }
  return getAgentNamesByTL(tlName || email);
}

/**
 * Gate for a TL changing a dispute's scores. Returns an error {status, error} or null when allowed.
 * Admins pass. A TL needs: TL ownership switched on, an open dispute (the flag), not one they raised, and an agent on their team.
 */
export async function checkTlResolve(opts: {
  role: string; email: string; flagId: string | undefined; agentName: string | null | undefined;
}): Promise<{ status: number; error: string } | null> {
  const { role, email, flagId, agentName } = opts;
  if (role !== 'tl') return null;
  const owner = await getDisputeOwner();
  if (owner !== 'tl') return { status: 403, error: 'Disputes are resolved by QA' };
  if (!flagId) return { status: 400, error: 'flagId required: a TL can only change scores to resolve a dispute' };
  const { storeGetIQSFlags } = await import('@/lib/store');
  const flag = (await storeGetIQSFlags())
    .map((r) => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .find((f): f is IQSFlag => Boolean(f && f.id === flagId));
  if (!flag) return { status: 404, error: 'Dispute not found' };
  if (!isTlActionable(flag, owner)) return { status: 409, error: 'This dispute is not open for TL review' };
  if ((flag.agentEmail || '').toLowerCase() === email.toLowerCase()) return { status: 403, error: 'You cannot resolve a dispute you raised' };
  const team = await getTlAgentNames(email);
  if (!agentInTeam(team, agentName ?? flag.agentName)) return { status: 403, error: 'Forbidden: this dispute is not for your team' };
  return null;
}
