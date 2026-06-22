import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import QualityShell from '@/components/quality/QualityShell';

export default async function QualityLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAny = session.user as any;
  const rawRole = userAny?.role as string | undefined;
  const role    = rawRole || (userAny?.isAdmin ? 'admin' : '');
  const email   = userAny?.email || '';
  const name    = userAny?.name  || email;

  if (!['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // Agent: no sidebar, just pass through
  if (role === 'agent') return <>{children}</>;

  // Admin / QA / TL: new QualityShell with sidebar nav
  return (
    <QualityShell role={role} email={email} name={name}>
      {children}
    </QualityShell>
  );
}
