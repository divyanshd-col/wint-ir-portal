import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';

export default async function QualityLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as any)?.role as string;

  if (!['admin', 'quality', 'tl', 'agent'].includes(role)) redirect('/');

  return <>{children}</>;
}
