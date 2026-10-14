import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import IRShell from '@/components/ir/IRShell';
import QualityShell from '@/components/quality/QualityShell';

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as any)?.role || '';
  if (!['agent', 'admin'].includes(role)) redirect('/');

  const email = (session.user as any)?.email || '';
  const config = await readConfig();
  const configUser = config.users.find((u: any) => (u.email || u.username)?.toLowerCase() === email.toLowerCase());
  let name: string = configUser?.agentName || '';
  if (!name && email) {
    const { getUserByEmail } = await import('@/lib/users');
    const dbUser = await getUserByEmail(email).catch(() => null);
    if (dbUser?.name) {
      name = dbUser.name;
    }
  }
  if (!name) {
    name = email.split('@')[0] || 'Agent';
  }

  // Admin visiting an agent page keeps the admin sidebar instead of switching to the IR Agent one.
  if (role === 'admin') {
    return (
      <QualityShell role={role} email={email} name={name}>
        {children}
      </QualityShell>
    );
  }

  return (
    <IRShell role={role} name={name}>
      {children}
    </IRShell>
  );
}
