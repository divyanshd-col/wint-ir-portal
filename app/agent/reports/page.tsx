import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import AgentReportsClient from '@/components/ir/AgentReportsClient';

export default async function AgentReportsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as any)?.role || '';
  const { hasSkill, getSkillsForPersona } = await import('@/lib/skills');
  const skills = (session.user as any)?.skills || (await getSkillsForPersona(role));
  if (!hasSkill({ ...(session.user as any), skills }, 'agent:reports:access')) redirect('/quality');

  const email = (session.user as any)?.email || '';
  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = await getUserByEmail(email).catch(() => null);
  const config = await readConfig();
  const configUser = config.users.find((u: any) => (u.email || u.username).toLowerCase() === email.toLowerCase());
  let agentName = dbUser?.name || configUser?.agentName || email.split('@')[0];
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  return <AgentReportsClient agentName={agentName} />;
}
