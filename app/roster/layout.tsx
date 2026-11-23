import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { hasNavSkill } from '@/lib/nav';

// Roster is its own top-level area: no section sidebar, the in-page tabs handle navigation.
export default async function RosterLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  // the same rule as the Roster tab, on the live skills (the session callback re-reads them), so the tab and the page never disagree
  const u = session.user as { role?: string; skills?: string[] };
  if (!hasNavSkill(u.role, u.skills, 'roster:view:access')) redirect('/');
  return (
    <div style={{ background: 'var(--page-bg)', minHeight: 'calc(var(--vh100) - var(--topbar-h))' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', width: '100%' }}>{children}</div>
    </div>
  );
}
