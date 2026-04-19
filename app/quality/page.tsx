import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import QualityClient from '@/components/QualityClient';
import AgentQualityClient from '@/components/AgentQualityClient';

export default async function QualityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role  = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // Agents get their personal quality dashboard
  if (role === 'agent') {
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username) === email);
    const selfAgentName = configUser?.agentName || undefined;
    return <AgentQualityClient userEmail={email} selfAgentName={selfAgentName} />;
  }

  // Admin / Quality / TL get the full team quality view
  // Only TL users get auto-filtered to their own data; admin/quality see everything
  let selfAgentName: string | undefined;
  if (role === 'tl') {
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username) === email);
    selfAgentName = configUser?.agentName || undefined;
  }

  return (
    <QualityClient
      userRole={role}
      userEmail={email}
      selfAgentName={selfAgentName}
    />
  );
}
