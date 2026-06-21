import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import TLChatTable from '@/components/quality/TLChatTable';

export default async function TLEvaluationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const role = ((session.user as any)?.role as string) || '';
  if (!['tl', 'admin'].includes(role)) redirect('/quality');

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Team Chats</h1>
      </div>
      <TLChatTable />
    </div>
  );
}
