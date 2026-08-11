import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import InsightsChatClient from '@/components/InsightsChatClient';

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'tl') redirect('/');

  const config = await readConfig();
  const flags = {
    callAnalysis: config.callAnalysisEnabled ?? false,
    cxDashboard: config.cxDashboardEnabled ?? false,
  };

  return (
    <InsightsChatClient
      username={user.email ?? 'admin'}
      role={user.role ?? 'admin'}
      isAdmin={true}
      flags={flags}
    />
  );
}
