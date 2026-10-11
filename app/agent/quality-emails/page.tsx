import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import MyQualityEmailsPage from '@/components/ir/MyQualityEmailsPage';

export default async function AgentQualityEmailsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const email = (session.user as any)?.email || '';
  const config = await readConfig().catch(() => ({} as any));
  const configUser = config.users?.find((u: any) => (u.email || u.username)?.toLowerCase() === email.toLowerCase());
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

  return <MyQualityEmailsPage agentName={agentName} />;
}
