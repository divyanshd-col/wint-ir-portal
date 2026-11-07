import { Suspense } from 'react';
import MemberAnalyticsDashboard from '@/components/tl/MemberAnalyticsDashboard';

export default function MemberAnalyticsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-500 font-sans text-sm">Loading Member Analytics...</div>}>
      <MemberAnalyticsDashboard />
    </Suspense>
  );
}
