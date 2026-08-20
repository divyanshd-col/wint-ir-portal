import { getServerSession } from 'next-auth';
import { headers } from 'next/headers';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AnalyticsMcpClient from '@/components/AnalyticsMcpClient';

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as { isAdmin?: boolean; role?: string; email?: string };
  if (!user?.isAdmin && user?.role !== 'tl') redirect('/');

  const config = await readConfig();
  const flags = {
    callAnalysis: config.callAnalysisEnabled ?? false,
    cxDashboard: config.cxDashboardEnabled ?? false,
  };

  // Build the public MCP URL from the incoming request so the connect
  // instructions show the real host (no client effect / hydration mismatch).
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  const mcpUrl = host ? `${proto}://${host}/api/mcp/mcp` : '/api/mcp/mcp';

  return (
    <AnalyticsMcpClient
      username={user.email ?? 'admin'}
      role={user.role ?? 'admin'}
      isAdmin={!!user?.isAdmin}
      flags={flags}
      mcpUrl={mcpUrl}
    />
  );
}
