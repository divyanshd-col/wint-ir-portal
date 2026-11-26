'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { fmtQ } from '@/lib/leave';
import { Banner, EmptyState, Modal, btnPrimary, btnSecondary } from '@/components/roster/ui';
import ApplyForm from './ApplyForm';
import { CopyId, StatusBadge, api, card, fmtCountdown, fmtDay, fmtRange, fmtWhen, muted, typeLabel, useCountdown, type Half } from './ui';

interface Row {
  leave_id: string; type: string; status: string; applied_at: string; reason: string | null; start_date: string; end_date: string; start_half: Half; end_half: Half;
  with_level: 'tl' | 'admin' | null; reject_code: string | null; reject_note: string | null; cancel_deadline: string | null; window_ends_at: string | null; leave_days: number; lop_days: number; tl_name: string | null;
}
interface Detail {
  request: Row & { user_id: number }; person: { name: string; role: string }; tlName: string | null; owner: boolean; leave: number; lop: number;
  days: { day: string; kind: string; charge: number; half: Half }[]; events: { at: string; event: string; text: string; reason: string | null; actor: string | null }[];
  ownerActions: { edit: boolean; cancel: boolean; sendToTl: boolean } | null;
}
const STATUSES = ['In process', 'Pending for approval', 'Approved', 'Auto-approved', 'Rejected', 'Auto-rejected', 'Auto-cancelled', 'Cancelled', 'Taken'];
const withWhom = (r: Row) => r.status === 'Pending for approval' ? (r.with_level === 'tl' ? `Your TL${r.tl_name ? ` (${r.tl_name})` : ''}` : 'An admin') : r.status === 'In process' ? 'The system (after 5 minutes)' : r.status === 'Auto-rejected' ? 'You: cancel or send to your TL' : '';
const KIND: Record<string, string> = { leave: 'Leave', lop: 'LOP', 'leave+lop': 'Leave + LOP', weekoff: 'Week-off', cancelled: 'Cancelled', none: '–' };

/** Everything the person needs to know about one request, with the buttons their status allows. */
export function RequestDetail({ id, today, onClose, onChanged }: { id: string; today: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'cancel'>('view');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api<Detail>(`/api/leave/requests/${id}`); if (r.ok) { setD(r.data); setError(null); } else setError(r.error); }, [id]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  const winLeft = useCountdown(d?.request.status === 'In process' ? d.request.window_ends_at : null);
  const dlLeft = useCountdown(d?.request.status === 'Auto-rejected' ? d.request.cancel_deadline : null);
  useEffect(() => { if (winLeft === 0) { const t = setTimeout(() => { void load(); onChanged(); }, 1500); return () => clearTimeout(t); } }, [winLeft, load, onChanged]);

  const act = async (action: 'cancel' | 'send_to_tl') => { setBusy(true); const r = await api(`/api/leave/requests/${id}`, 'POST', { action }); setBusy(false); if (!r.ok) { setError(r.error); setMode('view'); return; } setMode('view'); await load(); onChanged(); };
  const r = d?.request;
  const approved = r && (r.status === 'Approved' || r.status === 'Auto-approved');

  if (mode === 'edit' && d && r) {
    return (
      <Modal title={`Edit ${r.leave_id}`} width={640} onClose={() => setMode('view')}>
        <Banner kind="info">Editing sends it back through the 5-minute check, and it loses its place in the queue.</Banner>
        <ApplyForm today={today} excludeLeaveId={r.leave_id} submitLabel="Save and restart the 5 minutes" initial={{ start: r.start_date, end: r.end_date, startHalf: r.start_half, endHalf: r.end_half, reason: r.reason ?? '' }}
          onSubmit={async v => { const x = await api(`/api/leave/requests/${r.leave_id}`, 'PATCH', v); if (!x.ok) return x.error; setMode('view'); await load(); onChanged(); return null; }} />
      </Modal>
    );
  }
  if (mode === 'cancel' && r) {
    return (
      <Modal title="Cancel this request?" width={480} onClose={() => setMode('view')}>
        <div style={{ fontSize: 14 }}>{approved ? 'Your approved leave will be cancelled and the days go back to your balance. Your TL is told.' : 'The days go back to your balance.'}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" style={btnSecondary} onClick={() => setMode('view')}>Go back</button><button type="button" style={btnPrimary} disabled={busy} onClick={() => act('cancel')}>Okay, cancel it</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={r ? `${r.leave_id}` : 'Request'} width={720} onClose={onClose}>
      {error && <Banner kind="error">{error}</Banner>}
      {!d || !r ? (!error && <div style={muted}>Loading…</div>) : (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><StatusBadge status={r.status} /><span style={{ fontSize: 14 }}>{fmtRange(r.start_date, r.end_date, r.start_half, r.end_half)}</span>{!d.owner && <span style={muted}>{d.person.name}</span>}</div>
          <div style={{ fontSize: 13, color: 'var(--qa-text-2)' }}>{typeLabel(d.leave, d.lop)} · {fmtQ(d.leave + d.lop)} day{d.leave + d.lop === 1 ? '' : 's'}{d.lop > 0 ? ` (${fmtQ(d.lop)} LOP)` : ''}{r.reason ? <> · “{r.reason}”</> : null}</div>

          {r.status === 'In process' && winLeft !== null && <Banner kind="info">In process: {fmtCountdown(winLeft)} left. You can still edit or cancel it. Editing restarts the 5 minutes.</Banner>}
          {r.status === 'Auto-rejected' && <Banner kind="error">{r.reject_note}. Cancel it or send it to your TL{dlLeft !== null ? ` within ${fmtCountdown(dlLeft)}` : ''} (11:59 pm IST), or it is cancelled automatically.</Banner>}
          {r.status === 'Pending for approval' && <Banner kind="info">With {withWhom(r) || 'a person'}{(r as unknown as { with_since: string | null }).with_since ? ` since ${fmtWhen((r as unknown as { with_since: string }).with_since)}` : ''}.</Banner>}

          {d.ownerActions && (d.ownerActions.edit || d.ownerActions.cancel || d.ownerActions.sendToTl) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {d.ownerActions.edit && <button type="button" style={btnSecondary} onClick={() => setMode('edit')}>Edit</button>}
              {d.ownerActions.sendToTl && <button type="button" style={btnSecondary} disabled={busy} onClick={() => act('send_to_tl')}>Send to TL</button>}
              {d.ownerActions.cancel && <button type="button" style={btnSecondary} onClick={() => setMode('cancel')}>Cancel</button>}
            </div>)}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qa-text-2)', marginBottom: 6 }}>Day by day</div>
              {d.days.map(x => <div key={x.day} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderTop: '1px dashed var(--qa-border)' }}><span>{fmtDay(x.day)}</span><span style={{ color: x.kind === 'weekoff' || x.kind === 'none' || x.kind === 'cancelled' ? 'var(--qa-text-3)' : 'var(--qa-text)' }}>{KIND[x.kind] ?? x.kind}{x.charge > 0 && x.charge < 1 ? ` (${fmtQ(x.charge)})` : ''}</span></div>)}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qa-text-2)', marginBottom: 6 }}>Timeline</div>
              {d.events.map((e, i) => (
                <div key={i} style={{ padding: '5px 0', borderTop: '1px dashed var(--qa-border)', fontSize: 13 }}>
                  <div>{e.text}</div>
                  {e.reason && <div style={{ color: 'var(--qa-text-2)' }}>“{e.reason}”</div>}
                  <div style={muted}>{fmtWhen(e.at)}{e.actor ? ` · ${e.actor}` : ''}</div>
                </div>))}
            </div>
          </div>
        </>)}
    </Modal>
  );
}

/** The tracker: one row per request, with filters, and the detail of any request when you click it. */
export default function Requests({ today, openId, onOpen, refreshKey, onChanged }: { today: string; openId: string | null; onOpen: (id: string | null) => void; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const load = useCallback(async () => { const r = await api<{ requests: Row[] }>(`/api/leave/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`); if (r.ok) { setRows(r.data.requests); setError(null); } else setError(r.error); }, [status]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load, refreshKey]);
  if (error) return <div style={card}><EmptyState title="Couldn’t load your requests" body={error} /></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 13, color: 'var(--qa-text-2)' }}>Status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-700 bg-white"><option value="">All</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      <div style={{ ...card, padding: 0, overflow: 'auto' }}>
        {!rows ? <div style={{ padding: 20, ...muted }}>Loading…</div> : rows.length === 0 ? <EmptyState title="No requests yet" body="Leave you apply for shows here, with who it’s with and what you can do next." /> : (
          <table className="roster-tbl"><thead><tr><th>Leave ID</th><th>Dates</th><th>Days</th><th>Type</th><th>Status</th><th>Who it’s with</th><th>Applied</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.leave_id} onClick={() => onOpen(r.leave_id)} style={{ cursor: 'pointer' }}>
                <td><CopyId id={r.leave_id} /></td><td style={{ fontSize: 13 }}>{fmtRange(r.start_date, r.end_date, r.start_half, r.end_half)}</td>
                <td>{fmtQ(r.leave_days + r.lop_days)}</td><td style={{ fontSize: 12 }}>{typeLabel(r.leave_days, r.lop_days)}</td><td><StatusBadge status={r.status} /></td>
                <td style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>{withWhom(r)}</td><td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWhen(r.applied_at)}</td>
              </tr>))}</tbody></table>)}
      </div>
      {openId && <RequestDetail id={openId} today={today} onClose={() => onOpen(null)} onChanged={() => { void load(); onChanged(); }} />}
    </div>
  );
}
