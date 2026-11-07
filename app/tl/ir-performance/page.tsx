import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CxIrPerformanceDashboard from '@/components/cx/CxIrPerformanceDashboard';

export const metadata = { title: 'IR Performance | Wint IR Portal' };

export default async function IrPerformancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const rawRole = userAny?.role;
  const role = rawRole || (userAny?.isAdmin ? 'admin' : 'agent');

  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = userAny?.email ? await getUserByEmail(userAny.email).catch(() => null) : null;
  const resolvedRole = dbUser?.role || role;

  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const skills = (session.user as any)?.skills || (await getSkillsForPersona(resolvedRole));

  // Only Admin or users with tl:team_analytics:access can view whole department IR Performance
  if (resolvedRole !== 'admin' && !hasSkill({ ...userAny, role: resolvedRole, skills }, 'tl:team_analytics:access')) {
    redirect('/tl/member-analytics');
  }

  return (
    <div className="p-6 md:p-8 overflow-y-auto min-w-0 max-w-7xl">
      <CxIrPerformanceDashboard />
    </div>
  );
}

