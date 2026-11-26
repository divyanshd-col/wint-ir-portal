import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AgentAnalyticsDashboard from '@/components/quality/AgentAnalyticsDashboard';
import QAAnalyticsDashboard from '@/components/quality/QAAnalyticsDashboard';
import SimplifiedAgentDashboard from '@/components/ir/SimplifiedAgentDashboard';
import SimplifiedTLDashboard from '@/components/ir/SimplifiedTLDashboard';
import SimplifiedQADashboard from '@/components/ir/SimplifiedQADashboard';

export default async function QualityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as any;
  const rawRole = userAny?.role as string | undefined;
  // Older sessions may have isAdmin:true but no role field — treat them as admin
  const role = rawRole || (userAny?.isAdmin ? 'admin' : '');
  const email = (userAny?.email || '').toLowerCase();
  const name = userAny?.name || '';
  const isPcg = userAny?.activeDomain === 'pcg' || userAny?.platformDomain === 'pcg';

  if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  if (!isPcg && role === 'agent') {
    return <SimplifiedAgentDashboard agentName={name || email.split('@')[0] || 'Agent'} agentEmail={email} />;
  }

  if (!isPcg && role === 'tl') {
    return <SimplifiedTLDashboard tlName={name || email.split('@')[0] || 'Team Lead'} tlEmail={email} />;
  }

  if (!isPcg && role === 'quality') {
    return <SimplifiedQADashboard qaName={name || email.split('@')[0] || 'QA'} qaEmail={email} />;
  }

  // Admin / QA / TL / Agent: QA Analytics Dashboard
  return <QAAnalyticsDashboard />;
}
