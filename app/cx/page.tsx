import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import TLDashboard from '@/components/cx/TLDashboard';
import QADashboard from '@/components/cx/QADashboard';
import AgentDashboard from '@/components/cx/AgentDashboard';
import AdminDashboard from '@/components/cx/AdminDashboard';
import PageNav from '@/components/PageNav';

export const metadata = { title: 'CX Performance | Wint IR Portal' };

export default async function CXPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const user = session.user as any;
  const role = user.role as string | undefined;
  if (!role) redirect('/');

  const isAdmin = !!user.isAdmin;

  const { getSkillsForPersona, hasSkill } = await import('@/lib/skills');
  const skills = user.skills || (await getSkillsForPersona(role));

  const config = await readConfig();
  if (!config.cxDashboardEnabled || !hasSkill({ ...user, skills }, 'cx_dashboard:access')) {
    redirect('/');
  }

  const flags = {
    callAnalysis: config.callAnalysisEnabled ?? false,
    cxDashboard: config.cxDashboardEnabled ?? false,
  };

  return (
    <div className="flex h-screen bg-[var(--page-bg)]">
      {/* Sidebar */}
      <PageNav
        username={user.email ?? ''}
        role={role}
        isAdmin={isAdmin}
        skills={skills}
        flags={flags}
      />

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto">
        {/* Content */}
        <main className="px-6 py-6 lg:px-8 lg:py-8">
          {role === 'admin'   && <AdminDashboard />}
          {role === 'tl'      && <TLDashboard />}
          {role === 'quality' && <QADashboard />}
          {role === 'agent'   && <AgentDashboard />}
          {!['admin', 'tl', 'quality', 'agent'].includes(role) && (
            skills.includes('tl:team_analytics:access') ? <TLDashboard /> :
            skills.includes('quality:chat_eval:access') ? <QADashboard /> :
            <AgentDashboard />
          )}
        </main>
      </div>
    </div>
  );
}
