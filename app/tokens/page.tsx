import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import PageNav from '@/components/PageNav';
import TokensClient from '@/components/TokensClient';
import TokenUsageClient from '@/components/tokens/TokenUsageClient';
import Link from 'next/link';

export const metadata = {
  title: 'Token Usage & Cost Intelligence – Wint IR Portal',
};

export default async function TokenUsagePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) redirect('/login');

  const user = session.user as any;
  const isAdmin = !!user.isAdmin || user.role === 'admin';
  const isAllowed = isAdmin || user.role === 'quality' || user.role === 'tl';
  if (!isAllowed) {
    redirect('/quality');
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const currentView = resolvedSearchParams?.view === 'overview' ? 'overview' : 'bifurcation';

  const config = await readConfig();
  const flags = {
    callAnalysis: config.callAnalysisEnabled ?? false,
    cxDashboard: config.cxDashboardEnabled ?? false,
  };

  if (currentView === 'overview') {
    return (
      <div className="relative">
        <div className="absolute top-4 right-52 z-20 flex bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-semibold">
          <Link
            href="/tokens?view=bifurcation"
            className="px-3 py-1.5 rounded-lg text-gray-500 hover:text-gray-900 transition"
          >
            Job Bifurcation
          </Link>
          <span className="px-3 py-1.5 rounded-lg bg-white text-gray-900 shadow-xs font-bold">
            Overview
          </span>
        </div>
        <TokenUsageClient
          username={user.email ?? user.name ?? ''}
          role={user.role ?? 'admin'}
          isAdmin={isAdmin}
          flags={flags}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f5f3ee] text-gray-900 font-sans antialiased overflow-hidden">
      <PageNav
        username={user.email ?? user.name ?? ''}
        role={user.role ?? 'admin'}
        isAdmin={isAdmin}
        flags={flags}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="bg-white border-b border-gray-200 px-8 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">View:</span>
            <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-semibold">
              <span className="px-3 py-1 rounded-lg bg-white text-gray-900 shadow-xs font-bold">
                Job Bifurcation (New)
              </span>
              <Link
                href="/tokens?view=overview"
                className="px-3 py-1 rounded-lg text-gray-500 hover:text-gray-900 transition"
              >
                Overview Metrics
              </Link>
            </div>
          </div>
        </div>
        <TokensClient />
      </div>
    </div>
  );
}
