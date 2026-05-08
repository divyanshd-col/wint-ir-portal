import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CallAnalysisClient from '@/components/CallAnalysisClient';

export default async function CallAnalysisPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'tl') redirect('/');

  return (
    <CallAnalysisClient
      username={user.email ?? ''}
      role={user.role ?? ''}
      isAdmin={!!user.isAdmin}
    />
  );
}
