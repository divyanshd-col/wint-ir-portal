import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getHistory, appendHistory } from '@/lib/analytics/sessions';
import type { HistoryEntry } from '@/lib/analytics/types';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const email = session!.user!.email ?? '';
  const history = await getHistory(email);
  return NextResponse.json({ history });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const email = session!.user!.email ?? '';
  const body = await req.json().catch(() => ({}));
  const entry: HistoryEntry = {
    id:        crypto.randomUUID(),
    message:   body.message ?? '',
    response:  body.response ?? '',
    blocks:    body.blocks ?? [],
    type:      body.type ?? 1,
    filters:   body.filters ?? {},
    timestamp: new Date().toISOString(),
  };
  await appendHistory(email, entry);
  return NextResponse.json({ ok: true, id: entry.id });
}
