'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Item { id: number; created_at: string; text: string; leave_id: string | null; read_at: string | null; needs_ack: boolean; acked_at: string | null }

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** The bell in the top bar: unread count and a panel. Same messages as the leave pages show. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications');
      if (!r.ok) return;
      const j = await r.json();
      setItems(j.items ?? []); setUnread(j.unread ?? 0);
    } catch { /* offline: keep what we have */ }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markAll = async () => { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_all' }) }); void load(); };
  const ack = async (id: number) => { await fetch(`/api/notifications/${id}`, { method: 'POST' }); void load(); };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" className="topbar-icon-btn" aria-label={`Notifications, ${unread} unread`} onClick={() => { setOpen(o => !o); if (!open) void load(); }} style={{ position: 'relative' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 21h4" /></svg>
        {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--fail)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="topbar-menu" role="dialog" aria-label="Notifications" style={{ width: 360, right: 0, maxHeight: 460, overflow: 'auto', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--qa-border)' }}>
            <b style={{ fontSize: 14 }}>Notifications</b>
            <button type="button" onClick={markAll} disabled={unread === 0} style={{ border: 0, background: 'transparent', cursor: unread ? 'pointer' : 'default', fontSize: 12, color: 'var(--accent-active, var(--accent))', opacity: unread ? 1 : .5 }}>Mark all as read</button>
          </div>
          {items.length === 0 ? <div style={{ padding: '28px 14px', textAlign: 'center', fontSize: 13, color: 'var(--qa-text-3)' }}>You’re all caught up.</div> : items.map(n => (
            <div key={n.id} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--qa-border-sub)', background: n.read_at ? undefined : 'var(--qa-gray-50)' }}>
              <span aria-label={n.read_at ? 'Read' : 'Unread'} style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, flex: 'none', background: n.read_at ? 'transparent' : 'var(--accent)', border: n.read_at ? '1px solid var(--qa-border)' : 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--qa-text)' }}>{n.text}</div>
                <div style={{ fontSize: 12, color: 'var(--qa-text-3)', display: 'flex', gap: 10, marginTop: 2 }}>
                  <span>{ago(n.created_at)}</span>
                  {n.leave_id && <Link href={`/leave?req=${n.leave_id}`} onClick={() => setOpen(false)} style={{ color: 'var(--accent-active, var(--accent))' }}>{n.leave_id}</Link>}
                </div>
                {n.needs_ack && (n.acked_at ? <div style={{ fontSize: 12, color: 'var(--pass)', marginTop: 4 }}>You acknowledged this.</div> :
                  <button type="button" onClick={() => ack(n.id)} style={{ marginTop: 6, border: '1px solid var(--qa-border)', background: 'var(--qa-card)', borderRadius: 8, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>Okay</button>)}
              </div>
            </div>))}
        </div>)}
    </div>
  );
}
