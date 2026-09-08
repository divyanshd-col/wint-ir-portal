import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import TokenUsageClient from '@/components/tokens/TokenUsageClient';

export const metadata = {
  title: 'Token Usage & Cost – Wint IR Portal',
};

export default async function TokenUsagePage() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) redirect('/login');

  const user = session.user as any;
  const isAdmin = !!user.isAdmin || user.role === 'admin';
  if (!isAdmin) {
    // Strictly restricted to admins
    redirect('/quality');
  }

  const config = await readConfig();
  const flags = {
    callAnalysis: config.callAnalysisEnabled ?? false,
    cxDashboard: config.cxDashboardEnabled ?? false,
  };

  return (
    <TokenUsageClient
      username={user.email ?? user.name ?? ''}
      role={user.role ?? 'admin'}
      isAdmin={isAdmin}
      flags={flags}
    />
  );
}
