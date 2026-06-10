import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import QualityClient from '@/components/QualityClient';
import AgentQualityClient from '@/components/AgentQualityClient';

export default async function QualityPage({ searchParams }: { searchParams?: { agent?: string; tab?: string; section?: string; period?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role  = (session.user as any)?.role as string;
  const email = (session.user as any)?.email || '';

  if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // Agent: personal quality dashboard (unchanged)
  if (role === 'agent') {
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username) === email);
    const selfAgentName = configUser?.agentName || undefined;
    return <AgentQualityClient userEmail={email} selfAgentName={selfAgentName} />;
  }

  // Admin / TL / Quality: existing full team quality view
  const initialAgent   = searchParams?.agent || undefined;
  const VALID_TABS = ['performance', 'log', 'upload', 'reports', 'pending', 'calls', 'call-test', 'unified'];
  const tabParam   = searchParams?.tab || '';
  const initialTab = VALID_TABS.includes(tabParam) ? tabParam as any : undefined;
  const initialSection = searchParams?.section === 'reviewed' ? 'reviewed' as const : undefined;
  return (
    <QualityClient
      userRole={role}
      userEmail={email}
      initialAgent={initialAgent}
      initialTab={initialTab}
      initialSection={initialSection}
    />
  );
}
