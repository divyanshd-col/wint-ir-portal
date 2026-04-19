import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import HomeClient from '@/components/HomeClient';

export default async function Home() {
  const config = await readConfig();
  if (!config.isConfigured) redirect('/setup');

  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const username = (session.user?.name || session.user?.email || 'Investor') as string;
  const isAdmin = (session.user as any)?.isAdmin ?? false;
  const role = (session.user as any)?.role ?? 'agent';
  const historyEnabled = config.conversationHistoryEnabled ?? false;

  return (
    <div className="flex h-screen bg-[#f5f5f0] overflow-hidden">
      <HomeClient username={username} isAdmin={isAdmin} role={role} historyEnabled={historyEnabled} />
    </div>
  );
}
