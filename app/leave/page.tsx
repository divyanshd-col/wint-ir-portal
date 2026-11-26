import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/auth';
import { hasNavSkill } from '@/lib/nav';
import HomeScreen from '@/components/hrms/leave/HomeScreen';

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ req?: string }> }) {
  const { req } = await searchParams;
  if (req && /^LV-\d+$/.test(req)) redirect(`/leave/requests?req=${req}`); // links from older notifications
  const session = await getServerSession(authOptions);
  const u = session?.user as { role?: string; skills?: string[] } | undefined;
  if (!hasNavSkill(u?.role, u?.skills, 'leave:use:access') || u?.role === 'admin') redirect('/leave/approvals'); // admins don't apply: their Home is Approvals until the Manager home exists
  return <HomeScreen />;
}
