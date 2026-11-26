import LeaveClient from '@/components/leave/LeaveClient';

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ req?: string }> }) {
  const { req } = await searchParams;
  return <LeaveClient initialReq={req && /^LV-\d+$/.test(req) ? req : null} />;
}
