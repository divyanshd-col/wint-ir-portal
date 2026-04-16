import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import QualityClient from '@/components/QualityClient';

export default async function QualityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as any)?.role;
  if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // For agent role: find their linked agentName from config
  let selfAgentName: string | undefined;
  if (role === 'agent') {
    const config = await readConfig();
    const email = (session.user as any)?.email || '';
    const configUser = config.users.find(u => (u.email || u.username) === email);
    selfAgentName = configUser?.agentName || undefined;
  }

  return (
    <QualityClient
      userRole={role}
      userEmail={(session.user as any)?.email || ''}
      selfAgentName={selfAgentName}
    />
  );
}
