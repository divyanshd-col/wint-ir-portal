'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

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
    'quality:analytics:access', 'tl:member_analytics:access',
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
  const { data: session } = useSession();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('wint_sidebar');
      setCollapsed(saved ? saved === 'collapsed' : window.innerWidth <= 1100);
    } catch { /* storage blocked: keep the expanded default */ }
    setMounted(true);
  }, []);

  const toggleSidebar = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('wint_sidebar', next ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
    return next;
  });

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

  const filteredNav = navItems.filter(hasAccess);
  const displayRoleLabel = roleLabel || role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="quality-shell-container">
      <div className="quality-shell-body">
        {/* Sidebar */}
        <aside className={`quality-shell-sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="quality-shell-sidebar-head">
            <div className="quality-shell-sidebar-title">{displayRoleLabel}</div>
            <button
              type="button" className="quality-shell-sidebar-toggle" onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
            </button>
          </div>

          {filteredNav.map((item, i) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            // Admin sees every role's pages, so group them under QA / TL / IR Agent headings.
            const heading = role === 'admin' && item.section && item.section !== filteredNav[i - 1]?.section ? item.section : null;
            return (
              <React.Fragment key={`${item.label}:${item.href}`}>
                {heading && <div className="quality-shell-sidebar-title">{heading}</div>}
                <Link
                  href={item.href}
                  className={`quality-shell-sidebar-link ${active ? 'active' : ''}`}
                  title={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <span>
                    <Icon />
                  </span>
                  <span className="quality-shell-sidebar-label">{item.label}</span>
                </Link>
              </React.Fragment>
            );
          })}
        </aside>

        {/* Main content */}
        <main className="quality-shell-main" style={mainStyle}>
          {children}
        </main>
      </div>
    </div>
  );
}
