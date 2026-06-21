import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeAppendIQSFlag, storeGetIQSFlags, storeUpdateIQSFlag, storeAppendAuditEntry } from '@/lib/store';
import type { IQSFlag, IQSChallengedParam, IQSAuditEntry } from '@/lib/store';
import { CAT1_PARAMS, CAT2_PARAMS } from '@/lib/quality';
import { randomUUID } from 'crypto';

function qualityAccess(session: any) {
  return ['admin', 'quality', 'tl', 'agent'].includes(session?.user?.role || '');
}
function reviewAccess(session: any) {
  return ['admin', 'quality', 'tl'].includes(session?.user?.role || '');
}

// POST — IR or TL flags a score for review
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { scoreId, chatId, agentNote, challengedParams, raisedByRole } = await req.json();
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();
  const email = (session.user as any)?.email || '';
  const role  = (session.user as any)?.role  || '';
  const configUser = config.users.find(u => (u.email || u.username) === email);
  const agentName = configUser?.agentName || email.split('@')[0];

  const params: IQSChallengedParam[] = Array.isArray(challengedParams) ? challengedParams : [];
  const now = new Date().toISOString();

  // TL-raised dispute: CAT1 only, goes directly to QA (status: 'pending')
  if (raisedByRole === 'tl') {
    const flag: IQSFlag = {
      id: randomUUID(), scoreId, chatId, agentName, agentEmail: email,
      agentNote: agentNote || '', challengedParams: params, flaggedAt: now,
      raisedByRole: 'tl', paramCategory: 'cat1', status: 'pending',
    };
    await storeAppendIQSFlag(flag);
    await storeAppendAuditEntry({ id: randomUUID(), action: 'tl_dispute_raised', chatId, actorEmail: email, actorRole: role, ts: now, meta: { challengedParams: params, agentName } } as IQSAuditEntry);
    return NextResponse.json({ ok: true, flagId: flag.id });
  }

  // IR-raised dispute: route by param category
  const cat1Params = params.filter(p => CAT1_PARAMS.has(p.param));
  const cat2Params = params.filter(p => CAT2_PARAMS.has(p.param));
  const hasCat1 = cat1Params.length > 0;
  const hasCat2 = cat2Params.length > 0;

  const baseFlag = {
    scoreId, chatId, agentName, agentEmail: email,
    agentNote: agentNote || '', flaggedAt: now, raisedByRole: 'ir' as const,
    status: 'ir_pending_tl' as const,
  };

  if (hasCat1 && hasCat2) {
    const cat2Flag: IQSFlag = { ...baseFlag, id: randomUUID(), paramCategory: 'cat2', challengedParams: cat2Params };
    const cat1Flag: IQSFlag = { ...baseFlag, id: randomUUID(), paramCategory: 'cat1', challengedParams: cat1Params, parentFlagId: cat2Flag.id };
    await storeAppendIQSFlag(cat2Flag);
    await storeAppendIQSFlag(cat1Flag);
    await storeAppendAuditEntry({ id: randomUUID(), action: 'ir_dispute_raised', chatId, actorEmail: email, actorRole: role, ts: now, meta: { paramCategory: 'cat2', challengedParams: cat2Params, agentName } } as IQSAuditEntry);
    await storeAppendAuditEntry({ id: randomUUID(), action: 'ir_dispute_raised', chatId, actorEmail: email, actorRole: role, ts: now, meta: { paramCategory: 'cat1', challengedParams: cat1Params, agentName, siblingFlagId: cat2Flag.id } } as IQSAuditEntry);
    return NextResponse.json({ ok: true, flagIds: [cat2Flag.id, cat1Flag.id] });
  }

  const paramCategory = hasCat1 ? 'cat1' : 'cat2';
  const selectedParams = hasCat1 ? cat1Params : cat2Params;
  const flag: IQSFlag = { ...baseFlag, id: randomUUID(), paramCategory, challengedParams: selectedParams };
  await storeAppendIQSFlag(flag);
  await storeAppendAuditEntry({ id: randomUUID(), action: 'ir_dispute_raised', chatId, actorEmail: email, actorRole: role, ts: now, meta: { paramCategory, challengedParams: selectedParams, agentName } } as IQSAuditEntry);
  return NextResponse.json({ ok: true, flagId: flag.id });
}

// GET — list flags (quality/admin/tl: all; agent: own only)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

// PATCH — review a flag (quality/admin/tl) or cancel own flag (agent)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, status, reviewNote, action } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

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
    if (flag.status !== 'ir_pending_tl') return NextResponse.json({ error: 'Can only cancel pending disputes' }, { status: 400 });
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
