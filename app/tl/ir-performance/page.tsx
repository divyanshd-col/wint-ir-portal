import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CxIrPerformanceDashboard from '@/components/cx/CxIrPerformanceDashboard';

export const metadata = { title: 'IR Performance | Wint IR Portal' };

export default async function IrPerformancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const rawRole = userAny?.role;
  const role = rawRole || (userAny?.isAdmin ? 'admin' : 'agent');

  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = userAny?.email ? await getUserByEmail(userAny.email).catch(() => null) : null;
  const resolvedRole = dbUser?.role || role;

  // Admin only: department-wide rankings, and the data API (/api/cx/admin/ir-performance) refuses everyone else.
  if (resolvedRole !== 'admin') {
    redirect('/tl/member-analytics');
  }

  return (
    <div className="p-6 md:p-8 overflow-y-auto min-w-0 max-w-7xl">
      <CxIrPerformanceDashboard />
    </div>
  );
}

