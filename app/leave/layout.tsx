import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';

// Leave is its own area: no section sidebar, the in-page tabs handle navigation.
export default async function LeaveLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div style={{ background: 'var(--page-bg)', minHeight: 'calc(100vh - var(--topbar-h))' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>{children}</div>
    </div>
  );
}
