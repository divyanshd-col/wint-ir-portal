'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface PageNavProps {
  username: string;
  role?: string;
  isAdmin?: boolean;
  skills?: string[];
  flags?: { callAnalysis?: boolean; cxDashboard?: boolean };
}

const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
  admin: [
    'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
    'quality:analytics:access', 'tokens:view:access', 'settings:manage:access',
  ],
  tl: [
    'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
    'quality:analytics:access',
  ],
  quality: ['chat:access', 'cx_dashboard:access', 'quality:analytics:access'],
  agent: ['chat:access', 'quality:analytics:access'],
};

const icon = (d: React.ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">{d}</svg>
);
const ICONS = {
  mcp: icon(<><path d="M2 12l3-4 3 2 3-5 3 3" /><rect x="1" y="1" width="14" height="14" rx="1.5" /></>),
  cx: icon(<><rect x="1" y="9" width="3" height="6" rx="0.5" /><rect x="6" y="5" width="3" height="10" rx="0.5" /><rect x="11" y="1" width="3" height="14" rx="0.5" /></>),
  call: icon(<path d="M3 2a1 1 0 00-1 1v1.5a9 9 0 009 9H12.5a1 1 0 001-1v-2a1 1 0 00-1-1h-2a1 1 0 00-1 1v.5A6 6 0 014.5 5h.5a1 1 0 001-1V2a1 1 0 00-1-1H3z" />),
};

// Same key and values as RoleShell and the chat sidebar, so collapsing one collapses all.
const STORAGE_KEY = 'wint_sidebar';

/** Sidebar for the Analytics area (MCP, CX Dashboard, Call Analysis). Built on the shared .quality-shell-sidebar
 *  classes, like the chat and settings sidebars, so it matches the Quality pages. */
export default function PageNav({ role, isAdmin, skills: propSkills, flags }: PageNavProps) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === 'collapsed'); } catch { /* storage blocked: stay expanded */ }
  }, []);
  const toggle = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
    return next;
  });

  const sessionSkills = (session?.user as any)?.skills as string[] | undefined;
  const userRole = role || (session?.user as any)?.role || (isAdmin ? 'admin' : 'agent');
  const effectiveSkills = Array.isArray(propSkills) && propSkills.length
    ? propSkills
    : Array.isArray(sessionSkills) && sessionSkills.length
    ? sessionSkills
    : (DEFAULT_ROLE_SKILLS[userRole] || []);
  const can = (req: string) => isAdmin || userRole === 'admin' || effectiveSkills.includes(req);

  const items = [
    can('analytics:access') && { href: '/analytics', label: 'MCP', icon: ICONS.mcp },
    !!flags?.cxDashboard && can('cx_dashboard:access') && { href: '/cx', label: 'CX Dashboard', icon: ICONS.cx },
    !!flags?.callAnalysis && can('call_analysis:access') && { href: '/call-analysis', label: 'Call Analysis', icon: ICONS.call },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[];

  // A sidebar that only repeats the page it sits on is noise: show it once there is somewhere else to go.
  if (items.length <= 1) return null;

  return (
    <aside className={`quality-shell-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="quality-shell-sidebar-head">
        <div className="quality-shell-sidebar-title">Analytics</div>
        <button
          type="button" className="quality-shell-sidebar-toggle" onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
        </button>
      </div>
      <nav aria-label="Analytics pages">
        {items.map(i => {
          const active = pathname === i.href;
          return (
            <Link key={i.href} href={i.href} className={`quality-shell-sidebar-link${active ? ' active' : ''}`} aria-label={i.label} aria-current={active ? 'page' : undefined} title={collapsed ? i.label : undefined}>
              <span>{i.icon}</span>
              <span className="quality-shell-sidebar-label">{i.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
