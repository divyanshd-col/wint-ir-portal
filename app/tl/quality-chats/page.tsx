import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import QualityChatsPage from '@/components/tl/QualityChatsPage';

export default async function Page() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  const role = (user?.role || '').toLowerCase();
  if (role === 'tl') {
    redirect('/quality?section=quality&channel=chats');
  }
  return <QualityChatsPage />;
}
