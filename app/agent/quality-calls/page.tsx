import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import MyQualityCallsPage from '@/components/ir/MyQualityCallsPage';

export default async function AgentQualityCallsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as any)?.role || '';
  if (!['agent', 'admin'].includes(role)) redirect('/quality');

  const email = (session.user as any)?.email || '';
  const config = await readConfig();
  const configUser = config.users.find((u: any) => (u.email || u.username) === email);
  const agentName = configUser?.agentName || email.split('@')[0];

  return <MyQualityCallsPage agentName={agentName} />;
}
