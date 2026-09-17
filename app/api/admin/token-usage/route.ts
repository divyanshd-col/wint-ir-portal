import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getTokenUsageMetrics, MetricsFilter } from '@/lib/tokens/tracker';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { requireSkill } = await import('@/lib/skills');
    const auth = await requireSkill('tokens:view:access');
    if (auth.error) return auth.error;

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
