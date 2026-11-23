import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { hasNavSkill } from '@/lib/nav';

// Leave is its own area: no section sidebar, the in-page tabs handle navigation.
export default async function LeaveLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  // the same rule as the Leave tab, on the live skills (the session callback re-reads them), so the tab and the page never disagree
  const u = session.user as { role?: string; skills?: string[] };
  if (!(hasNavSkill(u.role, u.skills, 'leave:use:access') || hasNavSkill(u.role, u.skills, 'leave:approve:access'))) redirect('/');
  return (
    <div style={{ background: 'var(--page-bg)', minHeight: 'calc(var(--vh100) - var(--topbar-h))' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>{children}</div>
    </div>
  );
}
