import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { storeAppendIQSFlag, storeGetIQSFlags, storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
import type { IQSFlag, IQSChallengedParam, IQSAuditEntry } from '@/lib/store';
import { randomUUID } from 'crypto';

// Only QA/admin can give a dispute its final review decision — TL's only power
// over a dispute is forwarding it on (see /api/cx/tl/disputes/forward).
function reviewAccess(session: any) {
  return ['admin', 'quality'].includes(session?.user?.role || '');
}

// Every agent-raised dispute goes to the TL first for review/forwarding — no
// CAT1/CAT2 split, just a single queue the TL forwards on to QA.
export async function POST(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'agent']);
  if (response) return response;

  const { scoreId, chatId, agentNote, challengedParams } = await req.json();
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();
  const email = (session.user as any)?.email || '';
  const role  = (session.user as any)?.role  || '';
  const configUser = config.users.find(u => (u.email || u.username) === email);
  const agentName = configUser?.agentName || email.split('@')[0];

  const params: IQSChallengedParam[] = Array.isArray(challengedParams) ? challengedParams : [];
  const now = new Date().toISOString();

  const flag: IQSFlag = {
    id: randomUUID(), scoreId, chatId, agentName, agentEmail: email,
    agentNote: agentNote || '', challengedParams: params, flaggedAt: now,
    raisedByRole: 'ir', paramCategory: 'qa', status: 'pending',
  };
  const saved = await storeAppendIQSFlag(flag);
  if (!saved) {
    // Don't report success on a swallowed insert failure — the dispute would
    // simply never appear in anyone's queue.
    return NextResponse.json({ error: 'Failed to save dispute — please retry' }, { status: 500 });
  }
  await storeAppendAuditEntry({ id: randomUUID(), action: 'ir_dispute_raised', chatId, actorEmail: email, actorRole: role, ts: now, meta: { challengedParams: params, agentName } } as IQSAuditEntry);
  return NextResponse.json({ ok: true, flagId: flag.id });
}

// GET — list flags (quality/admin/tl: all; agent: own only)
export async function GET() {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const raw = await storeGetIQSFlags();
  const flags: IQSFlag[] = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);

  const role = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  if (role === 'agent') {
    return NextResponse.json({ flags: flags.filter(f => f.agentEmail === email) });
  }

  if (role === 'quality') {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig();
    const me = config.users.find(u => (u.email || u.username) === email);
    const myQAName = me?.agentName || email.split('@')[0];
    try {
      const { query } = await import('@/lib/cx/db');
      const rows = await query<{ name: string }>(
        `SELECT name FROM agents WHERE LOWER(qa_name) = LOWER($1)`,
        [myQAName],
      );
      const myAgents = new Set(rows.map((r: any) => (r.name || '').toLowerCase()));
      return NextResponse.json({ flags: flags.filter(f => myAgents.has((f.agentName || '').toLowerCase())) });
    } catch {
      // CX DB unavailable
    }
  }

  return NextResponse.json({ flags });
}

// The full lifecycle union from IQSFlag — writes outside it are rejected so the
// column can't accumulate arbitrary strings (it has no CHECK constraint in PG).
const VALID_FLAG_STATUSES = new Set(['ir_pending_tl', 'pending', 'tl_forwarded', 'tl_resolved', 'reviewed', 'cancelled']);

export async function PATCH(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'agent']);
  if (response) return response;

  const { id, status, reviewNote, action } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  if (!VALID_FLAG_STATUSES.has(status)) return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });

  const role = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  // Agent can cancel their own ir_pending_tl flag
  if (action === 'cancel' || status === 'cancelled') {
    if (role !== 'agent' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const raw = await storeGetIQSFlags();
    const flags = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
    const flag = flags.find((f: any) => f.id === id);
    if (!flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
    if (role === 'agent' && flag.agentEmail !== email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Agent can only withdraw a dispute while it's still awaiting TL review —
    // once forwarded to QA, it's out of the agent's hands.
    if (flag.status !== 'ir_pending_tl' && flag.status !== 'pending') {
      return NextResponse.json({ error: 'Can only cancel pending disputes' }, { status: 400 });
    }
    const ok = await storeUpdateIQSFlag(id, { status: 'cancelled', updatedAt: new Date().toISOString() });
    if (!ok) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (!reviewAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const ok = await storeUpdateIQSFlag(id, {
    status,
    reviewedBy: email,
    reviewedAt: new Date().toISOString(),
    reviewNote: reviewNote || '',
  });

  if (!ok) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
