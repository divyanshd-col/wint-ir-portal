import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import TLShell from '@/components/tl/TLShell';

export default async function TLLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as Record<string, string | undefined>;
  const rawRole = userAny?.role;
  const role    = rawRole || (userAny?.isAdmin ? 'admin' : 'agent');
  const email   = userAny?.email || '';
  const name    = userAny?.name  || email;

  if (!['admin', 'tl', 'agent'].includes(role)) redirect('/');

  return (
    <TLShell role={role} email={email} name={name}>
      {children}
    </TLShell>
  );
}
