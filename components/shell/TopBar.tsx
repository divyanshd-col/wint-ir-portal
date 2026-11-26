'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { activeTab, hasNavSkill, isAuthPath, topTabs } from '@/lib/nav';
import SecuritySection from '@/components/settings/SecuritySection';
import NotificationBell from '@/components/shell/NotificationBell';

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', quality: 'QA Analyst', tl: 'Team Lead', agent: 'IR Agent' };
const THEME_KEY = 'wint_theme';

const initials = (s: string) =>
  s.split(/[\s@._-]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';

// The theme lives on <html data-theme> (set before first paint by the script in layout.tsx); read it from there.
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
const readTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light');
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: theme just won't persist */ }
  };
  return (
    <button type="button" onClick={flip} className="topbar-icon-btn" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

export function AccountMenu({ name, email, role, roleLabel, isDhanush, isHarsh, isSindhu }: { name: string; email: string; role: string; roleLabel?: string; isDhanush?: boolean; isHarsh?: boolean; isSindhu?: boolean }) {
  const [open, setOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="topbar-account" ref={ref}>
      <button type="button" className="topbar-account-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        <span className="topbar-avatar">{initials(name || email)}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      {open && (
        <div className="topbar-menu" role="menu">
          <div className="topbar-menu-head">
            <div className="topbar-menu-name">{name || email}</div>
            {email && <div className="topbar-menu-sub">{email}</div>}
            <span className="topbar-role">{roleLabel ?? (ROLE_LABELS[role] ?? role)}</span>
          </div>
          {isHarsh && (
            <Link
              href="/analytics"
              role="menuitem"
              className="topbar-menu-item"
              onClick={() => setOpen(false)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 2v6M15 2v6" />
                <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
                <path d="M12 18v4" />
              </svg>
              MCP Connector
            </Link>
          )}
          {(isDhanush || isHarsh || isSindhu) && (
            <button
              type="button"
              role="menuitem"
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                setSecurityOpen(true);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Security
            </button>
          )}
          <div style={{ height: 1, background: 'var(--qa-border-sub, #f1f5f9)', margin: '4px 0' }} />
          <button type="button" role="menuitem" className="topbar-menu-item" onClick={() => signOut({ callbackUrl: '/login' })}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7" /></svg>
            Sign out
          </button>
        </div>
      )}

      {securityOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onClick={() => setSecurityOpen(false)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSecurityOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <SecuritySection onSuccess={() => setSecurityOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const pathname = usePathname() || '/';
  const { data: session, status } = useSession();
  const user = session?.user as any;
  const platformDomain = user?.platformDomain || 'cx';
  const activeDomain: 'cx' | 'pcg' = user?.activeDomain || (platformDomain === 'pcg' ? 'pcg' : 'cx');

  if (isAuthPath(pathname) || status === 'unauthenticated' || activeDomain === 'pcg' || pathname.startsWith('/admin/pcg-calls')) return null;
  const role = (user?.role ?? 'agent').toLowerCase();
  const isDhanush = role === 'agent';
  const isHarsh = role === 'tl';
  const isSindhu = role === 'quality';
  const isCustomUser = isDhanush || isHarsh || isSindhu;

  const defaultAllTabs = status === 'authenticated' ? topTabs(role, user?.skills, activeDomain) : [];
  // For Dhanush and Harsh: top pill toggles are removed in favor of the Home landing page and the top-right Home icon
  const tabs = isCustomUser ? [] : defaultAllTabs.filter((t) => t.key !== 'settings' && t.key !== 'analytics');
  const canOpenSettings = !isCustomUser && defaultAllTabs.some((t) => t.key === 'settings');
  const canOpenMcp = !isCustomUser && defaultAllTabs.some((t) => t.key === 'analytics');
  const current = activeTab(pathname);
  const settingsOpen = current === 'settings';
  const mcpOpen = pathname === '/analytics';

  const isTabActive = (t: { key: string }) => current === t.key;

  return (
    <>
      {/* Pages size themselves with h-screen / min-h-screen: take the bar's height off, only while it is shown. */}
      <style>{'.h-screen{height:calc(var(--vh100) - var(--topbar-h))}.min-h-screen{min-height:calc(var(--vh100) - var(--topbar-h))}'}</style>
      <header className="topbar">
        <span aria-hidden />
        {/* TLs and agents only get Quality: a one-item tab strip is noise, so show it only when there is something to switch between. */}
        {tabs.length > 1 && (
          <nav className="topbar-tabs" aria-label="Main">
            {tabs.map((t) => {
              const active = isTabActive(t);
              return (
                <Link key={t.key} href={t.href} className={`topbar-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="topbar-right" style={{ gridColumn: 3 }}>
          {canOpenMcp && (
            <Link href="/analytics" scroll={false} className={`topbar-icon-btn${mcpOpen ? ' active' : ''}`} aria-label="MCP: ask questions about the data in Claude" aria-current={mcpOpen ? 'page' : undefined} title="MCP">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6" /><path d="M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v4" /></svg>
            </Link>
          )}
          {canOpenSettings && (
            <Link href="/settings" scroll={false} className={`topbar-icon-btn${settingsOpen ? ' active' : ''}`} aria-label="Settings" aria-current={settingsOpen ? 'page' : undefined} title="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </Link>
          )}
          {isCustomUser && (
            <Link
              href="/"
              className={`topbar-icon-btn${pathname === '/' || pathname === '/home' ? ' active' : ''}`}
              aria-label="Home"
              title="Home"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </Link>
          )}
          {status === 'authenticated' && (hasNavSkill(role, user?.skills, 'leave:use:access') || hasNavSkill(role, user?.skills, 'leave:approve:access')) && <NotificationBell />}
          <ThemeToggle />
          {status === 'authenticated' && <AccountMenu name={user?.name ?? ''} email={user?.email ?? ''} role={role} isDhanush={isDhanush} isHarsh={isHarsh} isSindhu={isSindhu} />}
        </div>
      </header>
    </>
  );
}
