import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { analyzeSla, parseSlaRange, SLA_ANALYTICS_START } from '@/lib/sla-analytics';
import { fetchSlaEmails } from '@/lib/sla-analytics-db';

export const dynamic = 'force-dynamic';
// A 40-day range takes ~3s on Neon (7 days ~0.5s); leave room for a cold start.
export const maxDuration = 30;

/**
 * GET /api/cx/admin/sla-analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&closed=1
 * Email SLA / TAT for the admin dashboard, computed live from the stored Robylon events (see lib/sla-analytics.ts for the rules).
 * `closed=1` adds customer emails with no reply on tickets that are now Closed/Resolved. Days are IST; nothing before 1 Oct 2026.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session.user as any;
  const role = user.role || (user.isAdmin ? 'admin' : '');
  if (role !== 'admin' && !user.isAdmin) return NextResponse.json({ error: 'Forbidden. Admin role required.' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const { from, to } = parseSlaRange(sp.get('from'), sp.get('to'), now);
  if (from >= to) return NextResponse.json({ error: 'The start date must be before the end date.' }, { status: 400 });

  try {
    const rows = await fetchSlaEmails(from, to);
    const { summary, breaches } = analyzeSla(rows, now, { includeClosedUnreplied: sp.get('closed') === '1' });
    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString(), earliest: SLA_ANALYTICS_START.toISOString() },
      generatedAt: now.toISOString(),
      summary,
      breaches,
    });
  } catch (e) {
    console.error('[sla-analytics]', e);
    return NextResponse.json({ error: 'Could not load SLA analytics.' }, { status: 500 });
  }
}
