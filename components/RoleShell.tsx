'use client';

import React, { useState, useEffect } from 'react';
import { uiZoom } from '@/lib/ui-zoom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

export interface NavItem {
  label: string;
  href: string;
  icon: () => React.ReactElement;
  roles?: string[];
  skill?: string;
  /** Heading shown above this item (and the items after it) in the admin sidebar. */
  section?: string;
}

interface RoleShellProps {
  role: string;
  name: string;
  skills?: string[];
  children: React.ReactNode;
  navItems: NavItem[];
  roleLabel?: string;
  mainStyle?: React.CSSProperties;
}

const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
  admin: [
    'quality:analytics:access', 'quality:chat_eval:access', 'quality:call_eval:access',
    'tl:team_analytics:access', 'tl:member_analytics:access', 'tl:quality_chats:access',
    'tl:quality_calls:access', 'tl:reports:access', 'agent:my_analytics:access',
    'agent:my_chats:access', 'agent:my_calls:access', 'agent:reports:access',
  ],
  tl: [
    'quality:analytics:access', 'tl:team_analytics:access', 'tl:member_analytics:access',
    'tl:quality_chats:access', 'tl:quality_calls:access', 'tl:reports:access',
  ],
  quality: [
    'quality:analytics:access', 'quality:chat_eval:access', 'quality:call_eval:access',
  ],
  agent: [
    'quality:analytics:access', 'agent:my_analytics:access', 'agent:my_chats:access',
    'agent:my_calls:access', 'agent:reports:access',
  ],
};

export default function RoleShell({ role, skills: propSkills, children, navItems, roleLabel, mainStyle }: RoleShellProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Admin only: which QA / TL / IR Agent groups are open (all closed on load, except the one holding the current page),
  // and which items the admin hid with "Customize sidebar" (kept in this browser).
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const { data: session } = useSession();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('wint_sidebar');
      setCollapsed(saved ? saved === 'collapsed' : window.innerWidth <= 1100);
    } catch { /* storage blocked: keep the expanded default */ }
    try { setHidden(JSON.parse(localStorage.getItem('wint_sidebar_hidden') || '[]')); } catch { /* none hidden */ }
    const here = navItems.find(i => i.href === pathname)?.section;
    if (here) setOpenSections([here]);
    setMounted(true);
  }, []);

  const toggleSidebar = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('wint_sidebar', next ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
    return next;
  });

  const key = (i: NavItem) => `${i.label}:${i.href}`;
  const toggleHidden = (k: string) => setHidden(prev => {
    const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
    try { localStorage.setItem('wint_sidebar_hidden', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const toggleSection = (name: string) => setOpenSections(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);

  if (!mounted) {
    return <div className="quality-shell-container" />;
  }

  const sessionSkills = (session?.user as any)?.skills as string[] | undefined;
  const effectiveSkills = Array.isArray(propSkills) && propSkills.length
    ? propSkills
    : Array.isArray(sessionSkills) && sessionSkills.length
    ? sessionSkills
    : (DEFAULT_ROLE_SKILLS[role] || []);

  const hasAccess = (item: NavItem) => {
    if (role === 'admin') return true;
    if (item.roles && !item.roles.includes(role)) {
      return false;
    }
    if (item.skill) {
      return effectiveSkills.includes(item.skill);
    }
    return true;
  };

  const isAdmin = role === 'admin';
  // Admin: items hidden through Customize are dropped (but stay listed, greyed, while editing).
  const filteredNav = navItems.filter(hasAccess).filter(i => !isAdmin || editing || !hidden.includes(key(i)));
  const canSwitch = Boolean(session?.user?.isSuperAdmin) || session?.user?.platformDomain === 'both';
  const displayRoleLabel = roleLabel || role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="quality-shell-container">
      <div className="quality-shell-body">
        {/* Sidebar */}
        <aside className={`quality-shell-sidebar${collapsed ? ' collapsed' : ''}${isAdmin ? ' sb-admin' : ''}`}>
          <div className="quality-shell-sidebar-head">
            {canSwitch ? (!collapsed && <WorkspaceSwitcher />) : <div className="quality-shell-sidebar-title">{displayRoleLabel}</div>}
            <button
              type="button" className="quality-shell-sidebar-toggle" onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
              onMouseEnter={e => { if (collapsed) { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: 'Expand sidebar', top: (r.top + r.height / 2) / uiZoom(), left: r.right / uiZoom() + 10 }); } }}
              onMouseLeave={() => setTip(null)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
            </button>
          </div>
          {canSwitch && collapsed && <div className="quality-shell-ws-collapsed"><WorkspaceSwitcher collapsed /></div>}

          {filteredNav.map((item, i) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            // Admin sees every role's pages, so group them under QA / TL / IR Agent headings, each one collapsible.
            const heading = isAdmin && item.section && item.section !== filteredNav[i - 1]?.section ? item.section : null;
            const folded = isAdmin && !!item.section && !collapsed && !editing && !openSections.includes(item.section);
            const off = hidden.includes(key(item));
            return (
              <React.Fragment key={key(item)}>
                {heading && !collapsed && (
                  <button type="button" className="quality-shell-sidebar-title sb-group" onClick={() => toggleSection(heading)} aria-expanded={editing || openSections.includes(heading)}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: editing || openSections.includes(heading) ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }}><path d="M6 3l5 5-5 5" /></svg>
                    {heading}
                  </button>
                )}
                {heading && collapsed && <div className="quality-shell-sidebar-title" />}
                {!folded && (
                  <div className={`sb-row${off ? ' sb-off' : ''}`}>
                    {editing && <input type="checkbox" className="sb-check" checked={!off} onChange={() => toggleHidden(key(item))} aria-label={`Show ${item.label}`} />}
                    <Link
                      href={item.href}
                      className={`quality-shell-sidebar-link ${active ? 'active' : ''}`}
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                      onMouseEnter={e => { if (collapsed) { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: item.label, top: (r.top + r.height / 2) / uiZoom(), left: r.right / uiZoom() + 10 }); } }}
                      onMouseLeave={() => setTip(null)}
                      onFocus={e => { if (collapsed) { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: item.label, top: (r.top + r.height / 2) / uiZoom(), left: r.right / uiZoom() + 10 }); } }}
                      onBlur={() => setTip(null)}
                    >
                      <span>
                        <Icon />
                      </span>
                      <span className="quality-shell-sidebar-label">{item.label}</span>
                    </Link>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {isAdmin && !collapsed && (
            <div className="sb-customize">
              <button type="button" className="quality-shell-sidebar-link quality-shell-sidebar-btn" onClick={() => setEditing(e => !e)}>
                <span>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
                </span>
                <span className="quality-shell-sidebar-label">{editing ? 'Done' : 'Customize sidebar'}</span>
              </button>
            </div>
          )}
        </aside>
        {collapsed && tip && <div className="sb-tip" style={{ top: tip.top, left: tip.left }} role="tooltip">{tip.label}</div>}

        {/* Main content */}
        <main className="quality-shell-main" style={mainStyle}>
          {children}
        </main>
      </div>
    </div>
  );
}
