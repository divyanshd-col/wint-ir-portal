import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import LeaveClient from '@/components/leave/LeaveClient';

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ req?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const { req } = await searchParams;
  return <LeaveClient initialReq={req && /^LV-\d+$/.test(req) ? req : null} />;
}
