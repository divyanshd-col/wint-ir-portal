import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';

export default async function Home() {
  const config = await readConfig();
  if (!config.isConfigured) redirect('/setup');

  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const username = (session.user?.name as string) || 'Investor';
  const isAdmin = (session.user as any)?.isAdmin ?? false;

  return (
    <div className="flex h-screen bg-[#f5f5f0] overflow-hidden">
      <Sidebar username={username} isAdmin={isAdmin} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-[#1a1a1a] font-semibold text-base">IR Knowledge Base</h1>
            <p className="text-gray-400 text-xs mt-0.5">Powered by AI · Wint Wealth</p>
          </div>
          <div className="flex items-center gap-2 bg-[#2d9e4f]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#2d9e4f] rounded-full animate-pulse" />
            <span className="text-[#2d9e4f] text-xs font-medium">Knowledge base connected</span>
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <ChatInterface />
        </div>
      </main>
    </div>
  );
}
