import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import TLDashboard from '@/components/cx/TLDashboard';
import QADashboard from '@/components/cx/QADashboard';
import AgentDashboard from '@/components/cx/AgentDashboard';
import AdminDashboard from '@/components/cx/AdminDashboard';

export const metadata = { title: 'CX Performance | Wint IR Portal' };

export default async function CXPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const role = session.user.role as string | undefined;
  if (!role) redirect('/');

  const roleLabel =
    role === 'admin'   ? 'Admin'          :
    role === 'tl'      ? 'Team Lead'      :
    role === 'quality' ? 'Quality'        :
    role === 'agent'   ? 'Agent'          : role;

  return (
    <div className="min-h-screen bg-[#111111]">
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-white/8 bg-[#161616] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-14 flex items-center gap-4">
          {/* Back to portal */}
          <Link
            href="/"
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-200 transition text-sm shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Portal
          </Link>

          <span className="text-white/15 select-none">/</span>

          <span className="text-white font-semibold text-sm">CX Performance</span>

          <span className="ml-auto text-xs text-gray-600 bg-white/5 px-2.5 py-1 rounded-full">
            {roleLabel}
          </span>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 py-6 lg:px-8 lg:py-8">
        {role === 'admin'   && <AdminDashboard />}
        {role === 'tl'      && <TLDashboard />}
        {role === 'quality' && <QADashboard />}
        {role === 'agent'   && <AgentDashboard />}
        {!['admin','tl','quality','agent'].includes(role) && (
          <p className="text-gray-500 text-sm mt-8">Access not available for your role.</p>
        )}
      </main>
    </div>
  );
}
