import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import SlaAnalyticsDashboard from '@/components/cx/SlaAnalyticsDashboard';

export const metadata = { title: 'SLA / TAT Analytics | Wint IR Portal' };

export default async function SlaAnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const role = userAny?.role || (userAny?.isAdmin ? 'admin' : 'agent');

  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = userAny?.email ? await getUserByEmail(userAny.email).catch(() => null) : null;
  const resolvedRole = dbUser?.role || role;

  // Admin only; the data API (/api/cx/admin/sla-analytics) refuses everyone else too.
  if (resolvedRole !== 'admin') redirect('/tl/member-analytics');

  return (
    <div className="p-6 md:p-8 overflow-y-auto min-w-0 max-w-7xl">
      <SlaAnalyticsDashboard />
    </div>
  );
}
