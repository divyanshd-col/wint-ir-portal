import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
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

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-6 lg:px-8 lg:py-8">
      <div className="max-w-6xl mx-auto">
        {role === 'admin'   && <AdminDashboard />}
        {role === 'tl'      && <TLDashboard />}
        {role === 'quality' && <QADashboard />}
        {role === 'agent'   && <AgentDashboard />}
        {!['admin','tl','quality','agent'].includes(role) && (
          <p className="text-gray-500 text-sm">Access not available for your role.</p>
        )}
      </div>
    </main>
  );
}
