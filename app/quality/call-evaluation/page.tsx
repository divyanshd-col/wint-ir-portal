import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CallEvaluationPageClient from '@/components/quality/CallEvaluationPage';

export default async function CallEvaluationPage() {
  // QA/admin surface — gate here since the /quality layout admits agent and tl too.
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const skills = user?.skills || (await getSkillsForPersona(user?.role));
  const canAccess =
    hasSkill({ ...user, skills }, 'quality:call_eval:access') ||
    hasSkill({ ...user, skills }, 'tl:quality_calls:access') ||
    user?.role === 'admin' ||
    user?.role === 'quality' ||
    user?.role === 'tl';
  if (!canAccess) redirect('/quality');

  return <CallEvaluationPageClient />;
}
