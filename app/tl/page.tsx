import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import TLTeamAnalyticsDashboard from '@/components/tl/TLTeamAnalyticsDashboard';

export default async function TLPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const role    = userAny?.role || (userAny?.isAdmin ? 'admin' : 'agent');
  if (role === 'agent') redirect('/tl/member-analytics');
  if (!['admin', 'tl'].includes(role)) redirect('/');

  return <TLTeamAnalyticsDashboard />;
}
