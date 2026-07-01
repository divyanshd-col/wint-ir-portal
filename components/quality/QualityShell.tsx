'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  role:     string;
  email:    string;
  name:     string;
  children: React.ReactNode;
}

const NAV_ALL = [
  { label: 'Analytics',        href: '/quality',                roles: ['admin', 'quality'] },
  { label: 'Chat Evaluation',  href: '/quality/chat-evaluation', roles: ['admin', 'quality'] },
  { label: 'Call Evaluation',  href: '/quality/call-evaluation', roles: ['admin', 'quality'] },
  { label: 'Team Chats',       href: '/quality/tl-evaluation',  roles: ['admin', 'tl'] },
  { label: 'Member Analytics', href: '/tl/member-analytics',    roles: ['admin'] },
];

const BarChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const PhoneIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3-8.63 2 2 0 0 1 2-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);
const UsersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);

const NAV_ICONS: Record<string, () => React.ReactElement> = {
  '/quality':                BarChartIcon,
  '/quality/chat-evaluation': ChatIcon,
  '/quality/call-evaluation': PhoneIcon,
  '/quality/tl-evaluation':   UsersIcon,
  '/tl/member-analytics':     UserIcon,
};

const ROLE_LABELS: Record<string, string> = {
  admin:   'Admin',
  quality: 'QA Analyst',
  tl:      'Team Lead',
};

// Initials avatar from name
function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

export default function QualityShell({ role, name, children }: Props) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="quality-shell-container" />;
  }

  return (
    <div className="quality-shell-container">

      {/* ── Top Nav ─────────────────────────────────────────────────── */}
      <header className="quality-shell-header">
        {/* Wordmark */}
        <div className="quality-shell-wordmark">
          Wint Wealth
        </div>

        {/* Role pill */}
        <div className="quality-shell-role-container">
          <span className="quality-shell-role-pill">
            <span className="quality-shell-role-pill-dot" />
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>

        {/* User */}
        <div className="quality-shell-user">
          <span className="quality-shell-user-avatar">
            {initials(name)}
          </span>
          <span>{name}</span>
          <span style={{ color: 'var(--qa-text-3)', fontSize: 10 }}>▾</span>
        </div>
      </header>

      <div className="quality-shell-body">
        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className="quality-shell-sidebar">
          <div className="quality-shell-sidebar-title">
            {ROLE_LABELS[role] ?? role}
          </div>

          {NAV_ALL.filter(item => item.roles.includes(role)).map((item) => {
            const Icon = NAV_ICONS[item.href] ?? BarChartIcon;
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

        {/* ── Main content ──────────────────────────────────────────── */}
        <main className="quality-shell-main">
          {children}
        </main>
      </div>
    </div>
  );
}
