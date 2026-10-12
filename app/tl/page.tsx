import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import TLTeamAnalyticsDashboard from '@/components/tl/TLTeamAnalyticsDashboard';

export default async function TLPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const role    = userAny?.role || (userAny?.isAdmin ? 'admin' : 'agent');
  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const skills = (session.user as any)?.skills || (await getSkillsForPersona(role));

  if (!hasSkill({ ...userAny, skills }, 'tl:team_analytics:access')) {
    if (hasSkill({ ...userAny, skills }, 'agent:my_analytics:access')) {
      redirect('/tl/member-analytics');
    }
    redirect('/');
  }

  return <TLTeamAnalyticsDashboard />;
}
