'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { activeTab, isAuthPath, topTabs } from '@/lib/nav';

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

function ThemeToggle() {
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

function AccountMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const [open, setOpen] = useState(false);
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
            <span className="topbar-role">{ROLE_LABELS[role] ?? role}</span>
          </div>
          <button type="button" role="menuitem" className="topbar-menu-item" onClick={() => signOut({ callbackUrl: '/login' })}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7" /></svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

export default function TopBar() {
  const pathname = usePathname() || '/';
  const { data: session, status } = useSession();
  const user = session?.user as any;
  const platformDomain = user?.platformDomain || 'cx';
  const activeDomain: 'cx' | 'pcg' = user?.activeDomain || (platformDomain === 'pcg' ? 'pcg' : 'cx');

  if (isAuthPath(pathname) || status === 'unauthenticated' || activeDomain === 'pcg' || pathname.startsWith('/admin/pcg-calls')) return null;
  const role = user?.role ?? 'agent';
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const tabs = status === 'authenticated' ? topTabs(role, user?.skills, activeDomain) : [];
  const current = activeTab(pathname);

  const isTabActive = (t: { key: string }) => current === t.key;

  return (
    <>
      {/* Pages size themselves with h-screen / min-h-screen: take the bar's height off, only while it is shown. */}
      <style>{'.h-screen{height:calc(100vh - var(--topbar-h))}.min-h-screen{min-height:calc(100vh - var(--topbar-h))}'}</style>
      <header className="topbar">
        <Link href="/" className="topbar-logo" aria-label="Wint Wealth home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wint-logo.png" alt="Wint Wealth" width={22} height={22} />
        </Link>
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
        <div className="topbar-right">
          {/* Netflix-style Workspace Switcher for Super Admins */}
          {(isSuperAdmin || platformDomain === 'both') && (
            <div className="mr-2">
              <WorkspaceSwitcher compact={true} />
            </div>
          )}
          <ThemeToggle />
          {status === 'authenticated' && <AccountMenu name={user?.name ?? ''} email={user?.email ?? ''} role={role} />}
        </div>
      </header>
    </>
  );
}
