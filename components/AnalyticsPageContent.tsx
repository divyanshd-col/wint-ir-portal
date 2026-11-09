import { getServerSession } from 'next-auth';
import { headers } from 'next/headers';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AnalyticsMcpClient from '@/components/AnalyticsMcpClient';

/** The MCP screen as a server component: used by the full page (/analytics) and by the popup (@modal/(.)analytics). */
export default async function AnalyticsPageContent({ inModal = false }: { inModal?: boolean }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as { isAdmin?: boolean; role?: string; email?: string; skills?: string[] };
  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const skills = user?.skills || (await getSkillsForPersona(user?.role));
  if (!hasSkill({ ...user, skills }, 'analytics:access')) redirect('/');

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

  // The popup has no sidebar, so it lists the other Analytics pages itself (they were reached from this page's sidebar).
  const otherPages = [
    ...(flags.cxDashboard && hasSkill({ ...user, skills }, 'cx_dashboard:access') ? [{ href: '/cx', label: 'CX Dashboard' }] : []),
    ...(flags.callAnalysis && hasSkill({ ...user, skills }, 'call_analysis:access') ? [{ href: '/call-analysis', label: 'Call Analysis' }] : []),
  ];

  return (
    <AnalyticsMcpClient
      inModal={inModal}
      otherPages={otherPages}
      username={user.email ?? 'admin'}
      role={user.role ?? 'admin'}
      isAdmin={!!user?.isAdmin}
      flags={flags}
      mcpUrl={mcpUrl}
    />
  );
}
