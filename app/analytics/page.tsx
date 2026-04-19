import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import AnalyticsClient from '@/components/AnalyticsClient';

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (!(session.user as any)?.isAdmin) redirect('/');

  return <AnalyticsClient />;
}
