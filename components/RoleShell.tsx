'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  label: string;
  href: string;
  icon: () => React.ReactElement;
  roles?: string[];
}

interface RoleShellProps {
  role: string;
  name: string;
  children: React.ReactNode;
  navItems: NavItem[];
  roleLabel?: string;
  mainStyle?: React.CSSProperties;
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

export default function RoleShell({ role, name, children, navItems, roleLabel, mainStyle }: RoleShellProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="quality-shell-container" />;
  }

  const filteredNav = navItems.filter(item => !item.roles || item.roles.includes(role));
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
