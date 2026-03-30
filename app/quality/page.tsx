import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import QualityClient from '@/components/QualityClient';

export default async function QualityPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as any)?.role;
  if (!role || !['admin', 'quality', 'tl'].includes(role)) redirect('/');

  return <QualityClient />;
}
