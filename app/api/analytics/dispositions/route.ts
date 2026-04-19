import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getDispositions } from '@/lib/analytics/dispositions';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = await getDispositions();
    return NextResponse.json(payload);
  } catch (err: any) {
    console.error('[analytics/dispositions] fetch failed:', err?.message);
    return NextResponse.json({ error: 'Failed to load dispositions' }, { status: 500 });
  }
}
