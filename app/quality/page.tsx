import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AgentAnalyticsDashboard from '@/components/quality/AgentAnalyticsDashboard';
import QAAnalyticsDashboard from '@/components/quality/QAAnalyticsDashboard';

export default async function QualityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as any;
  const rawRole = userAny?.role as string | undefined;
  // Older sessions may have isAdmin:true but no role field — treat them as admin
  const role    = rawRole || (userAny?.isAdmin ? 'admin' : '');
  const email   = userAny?.email || '';

  if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // Admin / QA / TL / Agent: QA Analytics Dashboard
  return <QAAnalyticsDashboard />;
}
