import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeAppendIQSFlag, storeGetIQSFlags, storeUpdateIQSFlag } from '@/lib/store';
import type { IQSFlag, IQSChallengedParam } from '@/lib/store';
import { randomUUID } from 'crypto';

function qualityAccess(session: any) {
  return ['admin', 'quality', 'tl', 'agent'].includes(session?.user?.role || '');
}
function reviewAccess(session: any) {
  return ['admin', 'quality', 'tl'].includes(session?.user?.role || '');
}

// POST — agent flags a score for quality review
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { scoreId, chatId, agentNote, challengedParams } = await req.json();
  if (!scoreId || !chatId) return NextResponse.json({ error: 'scoreId and chatId required' }, { status: 400 });

  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();
  const email = (session.user as any)?.email || '';
  const configUser = config.users.find(u => (u.email || u.username) === email);
  const agentName = configUser?.agentName || email.split('@')[0];

  const flag: IQSFlag = {
    id: randomUUID(),
    scoreId,
    chatId,
    agentName,
    agentEmail: email,
    agentNote: agentNote || '',
    challengedParams: Array.isArray(challengedParams) ? (challengedParams as IQSChallengedParam[]) : undefined,
    flaggedAt: new Date().toISOString(),
    status: 'pending',
  };

  await storeAppendIQSFlag(flag);
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

  // Agents only see their own flags
  if (role === 'agent') {
    return NextResponse.json({ flags: flags.filter(f => f.agentEmail === email) });
  }

  // Quality role: filter to agents assigned to them in the CX DB
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
      // CX DB unavailable — fall through to return all
    }
  }

  return NextResponse.json({ flags });
}

// PATCH — quality/admin reviews a flag
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !reviewAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, status, reviewNote } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  const ok = await storeUpdateIQSFlag(id, {
    status,
    reviewedBy: (session.user as any)?.email || '',
    reviewedAt: new Date().toISOString(),
    reviewNote: reviewNote || '',
  });

  if (!ok) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
