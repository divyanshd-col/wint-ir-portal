import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/auth';
import { hasNavSkill } from '@/lib/nav';
import HrmsShell from './HrmsShell';
import { hrmsFontClass } from './fonts';

/**
 * Wraps every HRMS area (/leave, /roster): signed in, and holding the area's skill. The skills come from the session, which
 * re-reads the group's live skills, so switching one on in Settings > Skills works without logging in again. The tab and the
 * page use the same rule, so they never disagree.
 */
export default async function HrmsLayout({ area, children }: { area: 'leave' | 'roster'; children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const u = session.user as { role?: string; skills?: string[]; name?: string | null; email?: string | null };
  const ok = area === 'leave'
    ? hasNavSkill(u.role, u.skills, 'leave:use:access') || hasNavSkill(u.role, u.skills, 'leave:approve:access')
    : hasNavSkill(u.role, u.skills, 'roster:view:access');
  if (!ok) redirect('/');
  return <HrmsShell role={u.role ?? 'agent'} name={u.name ?? ''} email={u.email ?? ''} skills={u.skills} fontClass={hrmsFontClass}>{children}</HrmsShell>;
}
