import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import CallLinkTestClient from '@/components/CallLinkTestClient';

export const metadata = { title: 'Call Link Test — Wint IR Portal' };

export default async function CallLinkTestPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  if (!user?.isAdmin && !['quality', 'tl', 'admin'].includes(user?.role)) redirect('/');
  return <CallLinkTestClient userRole={user?.role} />;
}
