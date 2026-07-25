import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CallEvaluationPageClient from '@/components/quality/CallEvaluationPage';

export default async function CallEvaluationPage() {
  // QA/admin surface — gate here since the /quality layout admits agent and tl too.
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const role = ((session.user as any)?.role as string) || '';
  if (!['admin', 'quality'].includes(role)) redirect('/quality');

  return <CallEvaluationPageClient />;
}
