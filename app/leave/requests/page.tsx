import RequestsScreen from '@/components/hrms/leave/RequestsScreen';

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ req?: string }> }) {
  const { req } = await searchParams;
  return <RequestsScreen openId={req && /^LV-\d+$/.test(req) ? req : null} />;
}
