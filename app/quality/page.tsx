import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AgentAnalyticsDashboard from '@/components/quality/AgentAnalyticsDashboard';
import QAAnalyticsDashboard from '@/components/quality/QAAnalyticsDashboard';

export default async function QualityPage({ searchParams }: { searchParams?: { agent?: string; tab?: string; section?: string; period?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as any;
  const rawRole = userAny?.role as string | undefined;
  // Older sessions may have isAdmin:true but no role field — treat them as admin
  const role    = rawRole || (userAny?.isAdmin ? 'admin' : '');
  const email   = userAny?.email || '';

  if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // Agent: personal quality dashboard (unchanged)
  if (role === 'agent') {
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username) === email);
    const selfAgentName = configUser?.agentName || undefined;
    return <AgentAnalyticsDashboard userEmail={email} selfAgentName={selfAgentName} />;
  }

  // TL: dedicated TL analytics section
  if (role === 'tl') redirect('/tl');

  // Admin / QA: new QA Analytics Dashboard
  return <QAAnalyticsDashboard />;
}
