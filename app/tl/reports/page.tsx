import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AgentReportsClient from '@/components/ir/AgentReportsClient';

export default async function TLReportsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const rawRole = userAny?.role;
  const role = rawRole || (userAny?.isAdmin ? 'admin' : 'agent');
  const email = userAny?.email || '';

  if (role !== 'admin') redirect('/quality');

  const config = await readConfig();
  const configUser = config.users.find((u: any) => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const name = configUser?.agentName || email.split('@')[0];

  // Render the same report client component but with TL/Admin role so it runs in read-only mode for comments
  return <AgentReportsClient agentName={name} role={role} />;
}
