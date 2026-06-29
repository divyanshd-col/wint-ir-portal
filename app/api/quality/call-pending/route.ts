import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetCallSkipped, storeUpdateCallSkipped } from '@/lib/store';
import { readConfig } from '@/lib/config';

function qualityAccess(session: any) {
  return ['admin', 'quality', 'tl'].includes(session?.user?.role || '');
}

// GET — list call-skipped chats, filtered to quality person's agents
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const role  = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  const raw = await storeGetCallSkipped();
  const all = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);

  // Quality role: filter to their assigned agents
  let items = all;
  if (role === 'quality') {
    const config = await readConfig();
    const me = config.users.find(u => (u.email || u.username) === email);
    const myQAName = me?.agentName || email.split('@')[0];

    // Get agents assigned to this quality person from CX DB
    try {
      const { query } = await import('@/lib/cx/db');
      const rows = await query<{ name: string }>(
        `SELECT name FROM agents WHERE LOWER(qa_name) = LOWER($1)`,
        [myQAName],
      );
      const myAgents = new Set(rows.map((r: any) => (r.name || '').toLowerCase()));
      items = all.filter((f: any) => myAgents.has((f.agentName || '').toLowerCase()));
    } catch {
      // CX DB unavailable — return all
    }
  }

  return NextResponse.json({ items });
}

// PATCH — mark a call-skipped chat as reviewed
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, status, reviewNote } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  const ok = await storeUpdateCallSkipped(id, {
    status,
    reviewedBy: (session.user as any)?.email || '',
    reviewedAt: new Date().toISOString(),
    reviewNote: reviewNote || '',
  });

  if (!ok) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
