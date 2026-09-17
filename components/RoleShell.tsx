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

function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
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

export default function RoleShell({ role, name, skills: propSkills, children, navItems, roleLabel, mainStyle }: RoleShellProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

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
    if (item.skill) {
      return effectiveSkills.includes(item.skill);
    }
    if (item.roles) {
      return item.roles.includes(role);
    }
    return true;
  };

  const filteredNav = navItems.filter(hasAccess);
  const displayRoleLabel = roleLabel || role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="quality-shell-container">
      {/* Top Nav */}
      <header className="quality-shell-header">
        {/* Wordmark */}
        <div className="quality-shell-wordmark">
          Wint Wealth
        </div>

        {/* Role pill */}
        <div className="quality-shell-role-container">
          <span className="quality-shell-role-pill">
            <span className="quality-shell-role-pill-dot" />
            {displayRoleLabel}
          </span>
        </div>

        {/* User info */}
        <div className="quality-shell-user">
          <span className="quality-shell-user-avatar">
            {initials(name)}
          </span>
          <span>{name}</span>
          <span style={{ color: 'var(--qa-text-3)', fontSize: 10 }}>▾</span>
        </div>
      </header>

      <div className="quality-shell-body">
        {/* Sidebar */}
        <aside className="quality-shell-sidebar">
          <div className="quality-shell-sidebar-title">
            {displayRoleLabel}
          </div>

          {filteredNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`quality-shell-sidebar-link ${active ? 'active' : ''}`}
              >
                <span>
                  <Icon />
                </span>
                {item.label}
              </Link>
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
