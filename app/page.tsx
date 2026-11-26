import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import DhanushHomePage from '@/components/ir/DhanushHomePage';
import HarshHomePage from '@/components/ir/HarshHomePage';
import SindhuHomePage from '@/components/ir/SindhuHomePage';

// "/" has no page of its own: it sends each user to their home. Chat lives at /chat (top bar tab).
// The checks below are the same ones the target pages make, so a redirect can never bounce back here.
export default async function Home() {
  const config = await readConfig();
  if (!config.isConfigured) redirect('/setup');

  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const user = session.user as any;
  const email = (user?.email || '').toLowerCase();
  const name = user?.name || '';
  const role = (user?.role || '').toLowerCase();
  const isPcg = user?.activeDomain === 'pcg' || user?.platformDomain === 'pcg';

  // CX IR (Agent) landing page with application cards
  if (!isPcg && role === 'agent') {
    return <DhanushHomePage agentName={name || email.split('@')[0] || 'Agent'} />;
  }

  // CX TL landing page
  if (!isPcg && role === 'tl') {
    return <HarshHomePage tlName={name || email.split('@')[0] || 'Team Lead'} />;
  }

  // CX QA landing page
  if (!isPcg && role === 'quality') {
    return <SindhuHomePage qaName={name || email.split('@')[0] || 'QA'} />;
  }

  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const withSkills = { ...user, skills: user.skills || (await getSkillsForPersona(user.role)) };

  if (hasSkill(withSkills, 'analytics:access')) redirect('/analytics');
  if (['admin', 'quality', 'tl', 'agent'].includes(user.role ?? '') && hasSkill(withSkills, 'quality:analytics:access')) redirect('/quality');
  redirect('/chat');
}
