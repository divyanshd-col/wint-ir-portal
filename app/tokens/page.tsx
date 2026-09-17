import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import TokensClient from '@/components/TokensClient';

export default async function TokensPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'admin' && user?.role !== 'quality' && user?.role !== 'tl') {
    redirect('/');
  }

  return <TokensClient />;
}
