import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
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

  return (
    <div className="flex h-screen bg-[#1a1a1a]">
      {/* Sidebar */}
      <PageNav
        username={user.email ?? ''}
        role={role}
        isAdmin={isAdmin}
      />

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 bg-[#f5f3ee] overflow-y-auto">
        {/* Top bar */}
        <div className="border-b border-stone-200 bg-white sticky top-0 z-30 shrink-0">
          <div className="px-6 lg:px-8 h-14 flex items-center gap-3">
            <span className="text-stone-800 font-semibold text-sm">CX Performance</span>
            <span className="text-xs text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full ml-auto">
              {role === 'admin' ? 'Admin' :
               role === 'tl'    ? 'Team Lead' :
               role === 'quality' ? 'Quality' :
               role === 'agent'   ? 'Agent' : role}
            </span>
          </div>
        </div>

        {/* Content */}
        <main className="px-6 py-6 lg:px-8 lg:py-8">
          {role === 'admin'   && <AdminDashboard />}
          {role === 'tl'      && <TLDashboard />}
          {role === 'quality' && <QADashboard />}
          {role === 'agent'   && <AgentDashboard />}
          {!['admin', 'tl', 'quality', 'agent'].includes(role) && (
            <p className="text-stone-400 text-sm mt-8">Access not available for your role.</p>
          )}
        </main>
      </div>
    </div>
  );
}
