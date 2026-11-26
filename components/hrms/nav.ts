import { hasNavSkill } from '@/lib/nav';

/**
 * The HRMS left menu, as in the prototype's screen index (Me / Team / Admin). Pure, so it is unit-tested.
 * The portal has four roles, so the prototype's six map like this: Agent and Quality as they are, TL (a Sr TL is a TL for now),
 * and admin (the Manager, and HR). A screen only shows once it is built for that role.
 */
export type PortalRole = 'agent' | 'quality' | 'tl' | 'admin';
export type MenuGroup = 'Me' | 'Team' | 'Admin';
export type Access = 'Yes' | 'Own team' | 'Everyone' | 'View' | 'No';

interface Screen {
  key: string; label: string; icon: string; group: MenuGroup; href: string;
  access: Record<PortalRole, Access>;
  skill: string[];            // any one of these (admins always pass)
  built: PortalRole[];        // roles for which this screen exists in the portal today
}
const A = (agent: Access, quality: Access, tl: Access, admin: Access): Record<PortalRole, Access> => ({ agent, quality, tl, admin });
const LEAVE = ['leave:use:access'], APPROVE = ['leave:approve:access'], EITHER = ['leave:use:access', 'leave:approve:access'];

// Order, labels, icons and access follow the prototype's PAGES table. 'Manager home' is the admin's Home.
export const SCREENS: Screen[] = [
  { key: 'home',          label: 'Home',                     icon: 'home',     group: 'Me',    href: '/leave',                 access: A('Yes', 'Yes', 'Yes', 'Yes'),               skill: EITHER,  built: ['agent', 'quality', 'tl'] },
  { key: 'my-requests',   label: 'My requests',              icon: 'list',     group: 'Me',    href: '/leave/requests',        access: A('Yes', 'Yes', 'Yes', 'No'),                skill: LEAVE,   built: ['agent', 'quality', 'tl'] },
  { key: 'notifications', label: 'Notifications',            icon: 'bell',     group: 'Me',    href: '/leave/notifications',   access: A('Yes', 'Yes', 'Yes', 'Yes'),               skill: EITHER,  built: [] },
  { key: 'statement',     label: 'Statement',                icon: 'ledger',   group: 'Me',    href: '/leave/statement',       access: A('Yes', 'Yes', 'Yes', 'No'),                skill: LEAVE,   built: ['agent', 'quality', 'tl'] },
  { key: 'approvals',     label: 'Approvals',                icon: 'check',    group: 'Team',  href: '/leave/approvals',       access: A('No', 'No', 'Yes', 'Yes'),                 skill: APPROVE, built: ['tl', 'admin'] },
  { key: 'apply-behalf',  label: 'Apply on behalf',          icon: 'userplus', group: 'Team',  href: '/leave/apply-on-behalf', access: A('No', 'No', 'Own team', 'Everyone'),       skill: APPROVE, built: [] },
  { key: 'team-calendar', label: 'Team calendar',            icon: 'calendar', group: 'Team',  href: '/leave/team-calendar',   access: A('No', 'No', 'Own team', 'Everyone'),       skill: APPROVE, built: [] },
  { key: 'team',          label: 'Team and people',          icon: 'users',    group: 'Team',  href: '/leave/team',            access: A('No', 'No', 'Own team', 'Everyone'),       skill: APPROVE, built: [] },
  { key: 'roster',        label: 'Roster',                   icon: 'grid',     group: 'Team',  href: '/roster',                access: A('View', 'View', 'Own team', 'Everyone'),   skill: ['roster:view:access'], built: ['agent', 'quality', 'tl', 'admin'] },
  { key: 'people',        label: 'People management',        icon: 'userplus', group: 'Admin', href: '/leave/people',          access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
  { key: 'adjustments',   label: 'Adjustments and cash-outs', icon: 'scale',   group: 'Admin', href: '/leave/adjustments',     access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
  { key: 'payroll',       label: 'Payroll report',           icon: 'payroll',  group: 'Admin', href: '/leave/payroll',         access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
  { key: 'credit-status', label: 'Credit status',            icon: 'refresh',  group: 'Admin', href: '/leave/credit-status',   access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
  { key: 'audit-log',     label: 'Audit log',                icon: 'shield',   group: 'Admin', href: '/leave/audit-log',       access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
  { key: 'controls',      label: 'Controls',                 icon: 'sliders',  group: 'Admin', href: '/leave/controls',        access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
  { key: 'permissions',   label: 'Permissions',              icon: 'lock',     group: 'Admin', href: '/leave/permissions',     access: A('No', 'No', 'No', 'Yes'),                  skill: [],      built: [] },
];

export interface MenuItem { key: string; label: string; icon: string; href: string; scope: string | null }
export interface MenuSection { group: MenuGroup; items: MenuItem[] }

export const asPortalRole = (r: string | undefined): PortalRole => (r === 'admin' || r === 'tl' || r === 'quality' ? r : 'agent');

export function hrmsMenu(roleIn: string | undefined, skills: string[] | undefined): MenuSection[] {
  const role = asPortalRole(roleIn);
  const out: MenuSection[] = [];
  for (const group of ['Me', 'Team', 'Admin'] as MenuGroup[]) {
    const items = SCREENS.filter(s => s.group === group && s.built.includes(role) && s.access[role] !== 'No'
      && (role === 'admin' || s.skill.length === 0 || s.skill.some(k => hasNavSkill(role, skills, k))))
      .map(s => ({ key: s.key, label: s.label, icon: s.icon, href: s.href, scope: s.access[role] === 'Yes' ? null : s.access[role] }));
    if (items.length) out.push({ group, items });
  }
  return out;
}

/** Which menu item a page belongs to: the screen whose address is the longest match. /leave is only Home itself. */
export function activeKey(pathname: string): string | null {
  const hit = SCREENS.filter(s => s.href === '/leave' ? pathname === '/leave' : pathname === s.href || pathname.startsWith(s.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.key ?? null;
}

/** Everything under /leave and /roster is the HRMS: it has its own top bar and menu, so the portal's top bar steps aside. */
export const isHrmsPath = (pathname: string) => pathname === '/leave' || pathname.startsWith('/leave/') || pathname === '/roster' || pathname.startsWith('/roster/');
