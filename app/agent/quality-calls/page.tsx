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
  const configUser = config.users.find((u: any) => (u.email || u.username)?.toLowerCase() === email.toLowerCase());
  let agentName: string = configUser?.agentName || '';
  if (!agentName && email) {
    const { getUserByEmail } = await import('@/lib/users');
    const dbUser = await getUserByEmail(email).catch(() => null);
    if (dbUser?.name) {
      agentName = dbUser.name;
    }
  }
  if (!agentName) {
    agentName = email.split('@')[0] || 'Agent';
  }

  return <MyQualityCallsPage agentName={agentName} />;
}
