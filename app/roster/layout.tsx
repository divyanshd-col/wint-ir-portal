import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import QualityShell from '@/components/quality/QualityShell';

export default async function RosterLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const u = session.user as Record<string, string | undefined>;
  const role = u?.role || (u?.isAdmin ? 'admin' : 'agent');
  return <QualityShell role={role} name={u?.name || u?.email || ''}>{children}</QualityShell>;
}
