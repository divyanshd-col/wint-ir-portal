import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import TLTeamAnalyticsDashboard from '@/components/tl/TLTeamAnalyticsDashboard';

export default async function TLPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as Record<string, string | undefined>)?.role;
  if (!role || !['admin', 'tl'].includes(role)) redirect('/');

  return <TLTeamAnalyticsDashboard />;
}
