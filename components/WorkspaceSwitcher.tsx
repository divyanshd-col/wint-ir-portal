'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';

type Domain = 'cx' | 'pcg';

// Workspace glyphs, traced from the supplied PNGs with potrace (512 grid, y-up; the transform flips it).
const GLYPHS: Record<Domain, string> = {
  cx: 'M70 446c-51-13-66-78-25-112 41-33 104-3 104 50 0 41-39 72-79 62zM241 447c-70-14-94-98-43-147 38-35 100-28 129 16 24 36 16 88-19 114-8 6-22 13-31 15-9 3-28 3-36 2zM413 446c-23-4-43-24-48-47-11-46 29-87 75-77 40 8 62 53 44 90-13 27-42 41-71 34zM56 298c-25-4-45-20-53-43-2-8-2-9-3-38 0-24 0-30 1-35 5-17 18-29 35-32 10-2 49-1 49 0 0 46 27 97 64 121 3 2 6 5 6 5 0 1-11 11-16 14-13 7-18 8-50 9-16 0-31-1-33-1zM396 298c-12-2-24-8-33-16-4-3-6-6-6-6 0 0 4-3 9-6 34-26 56-65 60-107 1-7 1-12 1-13 0-1 39-2 49 0 17 3 30 15 35 32 1 5 1 11 1 35-1 29-1 30-3 37-8 21-24 37-44 43-7 1-59 3-69 1zM217 254c-39-7-71-34-84-71-6-19-7-60-2-75 7-20 21-34 41-41l8-2 76 0 77 0 7 2c20 7 34 22 41 41 3 9 4 41 2 55-7 48-42 83-88 91-12 3-67 2-78 0z',
  pcg: 'M139 426c-71-9-100-97-48-146 62-60 162 0 140 84-10 40-51 67-92 62zM331 426c-71-9-100-97-48-146 62-60 162 0 140 84-10 40-51 67-92 62zM127 234c-56-6-99-50-105-106-2-21-1-29 6-36 7-7 6-7 70-7 52 0 55 0 55 2-4 11-4 19-3 33 4 39 19 76 45 102 2 3 4 5 4 5-1 2-20 6-28 7-11 1-33 1-44 0zM310 234c-61-6-108-50-117-109-3-21 0-30 9-36l5-3 132-1c149 0 139-1 146 8 5 6 6 11 5 25-6 57-45 102-102 114-8 2-13 2-42 2-18 1-34 1-36 0z',
};

const WORKSPACES: { id: Domain; name: string; desc: string; home: string }[] = [
  { id: 'cx',  name: 'Wint CX',  desc: 'Customer Experience',  home: '/quality' },
  { id: 'pcg', name: 'Wint PCG', desc: 'Private Client Group', home: '/admin/pcg-calls' },
];

export function WorkspaceIcon({ domain, size = 24 }: { domain: Domain; size?: number }) {
  return (
    <span className={`ws-tile ws-${domain}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 512 512" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} fill="currentColor">
        <path transform="translate(0 512) scale(1 -1)" d={GLYPHS[domain]} />
      </svg>
    </span>
  );
}

/** Workspace switcher for Super Admins and users with access to both workspaces. Sits at the top of the sidebar, like
 *  Todoist's profile button. The menu is portalled to <body>: the sticky sidebar is its own stacking context and
 *  clips overflow, so a menu inside it would sit under the page content. */
export default function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { data: session, update } = useSession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const user = session?.user;
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  if (!isSuperAdmin && user?.platformDomain !== 'both') return null;

  const activeDomain: Domain = user?.activeDomain === 'pcg' ? 'pcg' : 'cx';
  const active = WORKSPACES.find(w => w.id === activeDomain) ?? WORKSPACES[0];

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left });
    setOpen(o => !o);
  };

  const handleSwitch = async (target: Domain) => {
    if (target === activeDomain || loading) { setOpen(false); return; }
    try {
      setLoading(true);
      const res = await fetch('/api/auth/switch-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: target }),
      });
      if (!res.ok) throw new Error('Failed to switch workspace profile');
      await update({ activeDomain: target });
      window.location.href = WORKSPACES.find(w => w.id === target)!.home;
    } catch (err) {
      console.error('[WorkspaceSwitcher] Error switching domain:', err);
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <div className="ws-root" ref={rootRef}>
      <button
        ref={btnRef} type="button" className={`ws-trigger${collapsed ? ' collapsed' : ''}`} onClick={toggle} disabled={loading}
        aria-haspopup="menu" aria-expanded={open} aria-label={`Workspace: ${active.name}. Switch workspace`} title={collapsed ? active.name : undefined}
      >
        <WorkspaceIcon domain={active.id} />
        {!collapsed && <span className="ws-trigger-name">{active.name}</span>}
        {!collapsed && (loading ? (
          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle opacity=".25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path opacity=".75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
        ) : (
          <svg className={`ws-chevron${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
        ))}
      </button>

      {open && createPortal(
        <div ref={menuRef} className="ws-menu" role="menu" aria-label="Switch workspace" style={{ top: pos.top, left: pos.left }}>
          <div className="ws-menu-head">
            <WorkspaceIcon domain={active.id} size={32} />
            <div className="ws-menu-head-text">
              <div className="ws-menu-title">{active.name}</div>
              <div className="ws-menu-sub">{active.desc}</div>
            </div>
            {isSuperAdmin && <span className="ws-menu-hint">Super Admin</span>}
          </div>
          <div className="ws-menu-sep" />
          <div className="ws-menu-label">Switch workspace</div>
          {WORKSPACES.map(w => (
            <button
              key={w.id} type="button" role="menuitemradio" aria-checked={w.id === activeDomain}
              className={`ws-menu-item${w.id === activeDomain ? ' active' : ''}`} onClick={() => handleSwitch(w.id)}
            >
              <WorkspaceIcon domain={w.id} size={22} />
              <span className="ws-menu-item-name">{w.name}</span>
              <span className="ws-menu-item-desc">{w.desc}</span>
              {w.id === activeDomain && (
                <svg className="ws-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 4.5" /></svg>
              )}
            </button>
          ))}
          <div className="ws-menu-sep" />
          <p className="ws-menu-note">Switching changes your navigation, analytics and dashboards.</p>
        </div>,
        document.body,
      )}
    </div>
  );
}
