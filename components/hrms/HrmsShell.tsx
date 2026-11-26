'use client';

import './hrms.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Avatar, Ico, cx } from './ui';
import HrmsBell from './HrmsBell';
import { activeKey, hrmsMenu } from './nav';

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', quality: 'QA Analyst', tl: 'Team Lead', agent: 'IR Agent' };
/** Screens tell the shell something changed (a decision, a cancel) so the Approvals count follows. */
export const HRMS_CHANGED = 'hrms:changed';

/** The prototype's app shell: black top bar (brand, bell, profile) and the left menu by role, around every HRMS page. */
export default function HrmsShell({ role, name, email, skills, fontClass, children }: { role: string; name: string; email: string; skills?: string[]; fontClass: string; children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const sections = useMemo(() => hrmsMenu(role, skills), [role, skills]);
  const current = activeKey(pathname);
  const hasApprovals = sections.some(s => s.items.some(i => i.key === 'approvals'));
  const hasNotifPage = sections.some(s => s.items.some(i => i.key === 'notifications'));
  const [waiting, setWaiting] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasApprovals) return;
    const load = async () => { try { const r = await fetch('/api/leave/approvals'); if (r.ok) setWaiting(((await r.json()).items ?? []).length); } catch { /* keep the last count */ } };
    queueMicrotask(() => { void load(); });
    const t = setInterval(load, 60000); window.addEventListener(HRMS_CHANGED, load);
    return () => { clearInterval(t); window.removeEventListener(HRMS_CHANGED, load); };
  }, [hasApprovals]);
  useEffect(() => {
    if (!menuOpen) return;
    const down = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [menuOpen]);

  return (
    <div className={cx('hrms', 'bricks', 'web', fontClass)} data-theme="dark">
      <div className="app">
        <header className="top">
          <Link className="brand" href="/" aria-label="Back to the Wint portal" title="Back to the Wint portal">
            <span className="logo"><img src="/hrms-wint-logo-white.png" alt="Wint" /></span><b>HRMS</b>
          </Link>
          <span className="spacer" />
          <div className="row" style={{ gap: 4, position: 'relative', flexWrap: 'nowrap' }}>
            <HrmsBell allPage={hasNotifPage} />
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button type="button" className="profile" onClick={() => setMenuOpen(o => !o)} aria-label="Profile menu" aria-haspopup="menu" aria-expanded={menuOpen}>
                <Avatar name={name || email} /><span><div className="nm">{name || email}</div><div className="rl">{ROLE_LABELS[role] ?? role}</div></span>
              </button>
              {menuOpen && (
                <div className="pop menu-pop" role="menu">
                  <div className="who"><div className="b14" style={{ fontWeight: 600 }}>{name || email}</div><div className="sm12 mut">{email}</div></div>
                  <Link href="/" role="menuitem" onClick={() => setMenuOpen(false)}><Ico n="home" />Back to portal</Link>
                  <button type="button" role="menuitem" onClick={() => signOut({ callbackUrl: '/login' })}><Ico n="logout" />Sign out</button>
                </div>)}
            </div>
          </div>
        </header>
        <nav className="menu" aria-label="Main menu">
          {sections.map(s => (
            <div className="mgroup" key={s.group}>
              <div className="t">{s.group}</div>
              {s.items.map(i => (
                <Link key={i.key} href={i.href} className={cx('mi', current === i.key && 'on')} aria-current={current === i.key ? 'page' : undefined}>
                  <Ico n={i.icon} />{i.label}
                  {i.key === 'approvals' && waiting > 0 ? <span className="count">{waiting}</span> : i.scope && <span className="scope">{i.scope}</span>}
                </Link>))}
            </div>))}
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
