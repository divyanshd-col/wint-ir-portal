import { Suspense } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import MemberAnalyticsDashboard from '@/components/tl/MemberAnalyticsDashboard';

export default async function MemberAnalyticsPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  const role = (user?.role || '').toLowerCase();
  if (role === 'agent') {
    redirect('/quality');
  }
  if (role === 'tl') {
    redirect('/quality?section=performance&sub=member_analytics');
  }

  return (
    <Suspense fallback={<div className="p-8 text-zinc-500 font-sans text-sm">Loading Member Analytics...</div>}>
      <MemberAnalyticsDashboard />
    </Suspense>
  );
}
