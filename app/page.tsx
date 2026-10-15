import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';

// "/" has no page of its own: it sends each user to their home. Chat lives at /chat (top bar tab).
// The checks below are the same ones the target pages make, so a redirect can never bounce back here.
export default async function Home() {
  const config = await readConfig();
  if (!config.isConfigured) redirect('/setup');

  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const user = session.user as { isAdmin?: boolean; role?: string; skills?: string[] };
  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const withSkills = { ...user, skills: user.skills || (await getSkillsForPersona(user.role)) };

  if (hasSkill(withSkills, 'analytics:access')) redirect('/analytics');
  if (['admin', 'quality', 'tl', 'agent'].includes(user.role ?? '') && hasSkill(withSkills, 'quality:analytics:access')) redirect('/quality');
  redirect('/chat');
}
