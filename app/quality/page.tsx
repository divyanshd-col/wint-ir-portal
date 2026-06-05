import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import QualityClient from '@/components/QualityClient';
import AgentQualityClient from '@/components/AgentQualityClient';
import QAAnalyticsDashboard from '@/components/quality/QAAnalyticsDashboard';

export default async function QualityPage({ searchParams }: { searchParams?: { agent?: string; tab?: string; period?: string } }) {
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

  // Quality role: new QA Analytics Dashboard
  if (role === 'quality') {
    return <QAAnalyticsDashboard />;
  }

  // Admin / TL: existing full team quality view
  const initialAgent = searchParams?.agent || undefined;
  const initialTab   = searchParams?.tab === 'log' ? 'log' : undefined;
  return (
    <QualityClient
      userRole={role}
      userEmail={email}
      initialAgent={initialAgent}
      initialTab={initialTab}
    />
  );
}
