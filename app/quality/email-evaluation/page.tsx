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

  // Access for QA, Admin, TL, and Agent users (scoped automatically by role)
  if (!['admin', 'quality', 'tl', 'agent'].includes(role)) {
    redirect('/quality');
  }

  return <EmailEvaluationPage />;
}
