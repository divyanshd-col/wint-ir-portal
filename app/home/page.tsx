import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import DhanushHomePage from '@/components/ir/DhanushHomePage';
import HarshHomePage from '@/components/ir/HarshHomePage';
import SindhuHomePage from '@/components/ir/SindhuHomePage';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const user = session.user as any;
  const email = (user?.email || '').toLowerCase();
  const name = user?.name || '';
  const role = (user?.role || '').toLowerCase();

  if (role === 'agent') {
    return <DhanushHomePage agentName={name || email.split('@')[0] || 'Agent'} />;
  }
  if (role === 'tl') {
    return <HarshHomePage tlName={name || email.split('@')[0] || 'Team Lead'} />;
  }
  if (role === 'quality') {
    return <SindhuHomePage qaName={name || email.split('@')[0] || 'QA'} />;
  }

  redirect('/');
}
