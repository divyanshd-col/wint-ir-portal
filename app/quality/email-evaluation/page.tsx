import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import EmailEvaluationPage from '@/components/quality/EmailEvaluationPage';

export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userAny = session.user as any;
  const rawRole = userAny?.role as string | undefined;
  const role = rawRole || (userAny?.isAdmin ? 'admin' : '');

  // QA and Admin access
  if (!['admin', 'quality'].includes(role)) {
    redirect('/quality');
  }

  return <EmailEvaluationPage />;
}
