'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Ico, cx } from './ui';

interface Item { id: number; created_at: string; text: string; leave_id: string | null; read_at: string | null; needs_ack: boolean; acked_at: string | null }
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
};

/** The prototype's bell and notification panel (shell.jsx NotificationPanel), on the real notifications. */
export default function HrmsBell({ allPage }: { allPage: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/notifications'); if (!r.ok) return; const j = await r.json(); setItems(j.items ?? []); setUnread(j.unread ?? 0); } catch { /* offline: keep what is shown */ }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const markAll = async () => { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_all' }) }); void load(); };
  const ack = async (id: number) => { await fetch(`/api/notifications/${id}`, { method: 'POST' }); void load(); };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="iconbtn" aria-label={`Notifications, ${unread} unread`} onClick={() => { setOpen(o => !o); if (!open) void load(); }}><Ico n="bell" size={20} />{unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}</button>
      {open && (
        <div className="pop npanel" role="dialog" aria-label="Notifications">
          <div className="nhead"><span className="h2s">Notifications</span><span className="spacer" /><Button kind="tertiary" size="sm" onClick={markAll} disabled={unread === 0}>Mark all as read</Button></div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {items.length === 0 ? <EmptyState title="You're all caught up" body="New messages show here." /> : items.map(n => (
              <div key={n.id} className={cx('nitem', !n.read_at && 'unread')}>
                <span className={cx('ndot', !!n.read_at && 'read')} aria-label={n.read_at ? 'Read' : 'Unread'} />
                <div><div className="tx">{n.text}</div>
                  <div className="mt"><span>{ago(n.created_at)}</span>{n.leave_id && <Link href={`/leave/requests?req=${n.leave_id}`} onClick={() => setOpen(false)}>{n.leave_id}</Link>}</div>
                  {n.acked_at && <div className="sm12" style={{ color: 'var(--green-400)', marginTop: 6 }}>You acknowledged this.</div>}
                  {n.needs_ack && !n.acked_at && <div style={{ marginTop: 8 }}><Button kind="secondary" size="sm" onClick={() => ack(n.id)}>Okay</Button></div>}
                </div>
              </div>))}
          </div>
          {allPage && <div style={{ padding: '10px 16px', borderTop: '1px solid var(--hair)' }}><Link href="/leave/notifications" onClick={() => setOpen(false)} className="b14">View all notifications ›</Link></div>}
        </div>)}
    </div>
  );
}
