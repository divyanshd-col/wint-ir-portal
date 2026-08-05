import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import ChatEvaluationPage from '@/components/quality/ChatEvaluationPage';

export default async function Page() {
  // Chat evaluation is a QA/admin surface. The /quality layout + middleware admit
  // agent and tl to the section (for their own dashboards), so this page must gate
  // itself — otherwise a tl/agent hitting the URL directly renders the QA scoring UI.
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userAny = session.user as any;
  const rawRole = userAny?.role as string | undefined;
  const role = rawRole || (userAny?.isAdmin ? 'admin' : '');
  if (!['admin', 'quality'].includes(role)) redirect('/quality');

  return <ChatEvaluationPage role={role} />;
}
