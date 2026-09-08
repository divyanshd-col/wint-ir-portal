import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getTokenUsageMetrics, MetricsFilter } from '@/lib/tokens/tracker';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = (session.user as any)?.role;
    const isAdmin = !!(session.user as any)?.isAdmin || role === 'admin';
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. Token usage metrics are only accessible to administrators.' },
        { status: 403 }
      );
    }

    const searchParams = req.nextUrl.searchParams;
    const timeframe = (searchParams.get('timeframe') || '30d') as MetricsFilter['timeframe'];
    const model = searchParams.get('model') || undefined;
    const feature = searchParams.get('feature') || undefined;

    const metrics = await getTokenUsageMetrics({
      timeframe,
      model,
      feature,
    });

    return NextResponse.json(metrics, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    console.error('[api/admin/token-usage] Error fetching metrics:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch token usage metrics' },
      { status: 500 }
    );
  }
}
