import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CallQualityTestClient from '@/components/CallQualityTestClient';

export default async function CallQualityTestPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  if (!user?.isAdmin && !['quality', 'tl', 'admin'].includes(user?.role)) redirect('/');
  return <CallQualityTestClient />;
}
