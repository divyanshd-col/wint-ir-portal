import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import QualityShell from '@/components/quality/QualityShell';

export default async function QualityLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role  = (session.user as any)?.role as string;
  const email = (session.user as any)?.email || '';
  const name  = (session.user as any)?.name  || email;

  if (!['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  // Only quality role gets the new sidebar shell; others fall through to existing page
  if (role !== 'quality') {
    return <>{children}</>;
  }

  return (
    <QualityShell role={role} email={email} name={name}>
      {children}
    </QualityShell>
  );
}
