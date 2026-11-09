'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** A page shown as a popup over whatever page is open (Settings, MCP). Closing (X, Esc, click outside) goes back to that page. */
export default function RouteModal({ label, size = 'wide', children }: { label: string; size?: 'wide' | 'narrow'; children: ReactNode }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = () => router.back();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';   // the page behind must not scroll while the popup is open
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) router.back(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
      before?.focus?.();
    };
  }, [router]);

  return (
    <div className="route-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialogRef} className={`route-modal-panel ${size}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button type="button" className="route-modal-close" onClick={close} aria-label={`Close ${label}`} title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
        {children}
      </div>
    </div>
  );
}
