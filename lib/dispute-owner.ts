import type { IQSFlag } from '@/lib/store';
// The rules below are pure (unit-tested offline); the DB-backed helpers import their dependencies lazily.

/**
 * Who resolves CX disputes (chats, calls, emails; PCG is a separate flow and never reads this).
 *  - 'qa' (default): the old flow. IR raises, the TL forwards to QA, QA edits the scores.
 *  - 'tl': IR disputes are reviewed and resolved by the TL of the agent. QA only audits what falls at or below the review threshold.
 * Set DISPUTES_OWNER=tl in the environment to switch, unset it (or 'qa') to roll back. Nothing in the data changes with the switch.
 *
 * TL-raised disputes always stay with QA: a TL cannot resolve a dispute they raised themselves.
 */
export const disputesOwnedByTL = () => process.env.DISPUTES_OWNER === 'tl';

const OPEN_STATUSES = ['pending', 'ir_pending_tl', 'tl_forwarded'];

/** True when this flag is in the TL's queue: TL owns disputes, it was raised by IR (not a TL), and nobody has decided it yet.
 *  Includes 'tl_forwarded' so disputes already sitting with QA at the switch move to the TL. */
export const isTlActionable = (f: Pick<IQSFlag, 'status' | 'raisedByRole'>) =>
  disputesOwnedByTL() && f.raisedByRole !== 'tl' && OPEN_STATUSES.includes(f.status);

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
  if (!disputesOwnedByTL()) return { status: 403, error: 'Disputes are resolved by QA' };
  if (!flagId) return { status: 400, error: 'flagId required: a TL can only change scores to resolve a dispute' };
  const { storeGetIQSFlags } = await import('@/lib/store');
  const flag = (await storeGetIQSFlags())
    .map((r) => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .find((f): f is IQSFlag => Boolean(f && f.id === flagId));
  if (!flag) return { status: 404, error: 'Dispute not found' };
  if (!isTlActionable(flag)) return { status: 409, error: 'This dispute is not open for TL review' };
  if ((flag.agentEmail || '').toLowerCase() === email.toLowerCase()) return { status: 403, error: 'You cannot resolve a dispute you raised' };
  const team = await getTlAgentNames(email);
  if (!agentInTeam(team, agentName ?? flag.agentName)) return { status: 403, error: 'Forbidden: this dispute is not for your team' };
  return null;
}
