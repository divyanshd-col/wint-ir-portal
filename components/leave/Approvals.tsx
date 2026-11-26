'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { fmtQ } from '@/lib/leave';
import { Avatar, Banner, EmptyState, btnPrimary, btnSecondary, inputCls } from '@/components/roster/ui';
import { CopyId, StatusBadge, api, card, fmtDay, fmtRange, fmtWhen, muted, typeLabel, type Half } from './ui';
import { RequestDetail } from './Requests';

interface Item {
  request: { leave_id: string; user_id: number; status: string; applied_at: string; reason: string | null; start_date: string; end_date: string; start_half: Half; end_half: Half; with_level: 'tl' | 'admin' | null; with_since: string | null; sent_to_tl: boolean };
  person: { name: string; role: string }; tlName: string | null; leave: number; lop: number;
  stretch?: number; fullHalves?: { day: string; half: string; count: number; limit: number }[];
  actions?: { approve: boolean; reject: boolean; forward: boolean; approveBlockedWhy?: string; needsOverLimitOk?: boolean };
  noticeNeeded?: number; noticeGiven?: number; whyHere?: string; balance?: number; waitingSince?: string | null;
  othersOff?: { name: string; day: string; half: string; status: string }[];
}
const ROLE = (r: string) => r === 'tl' ? 'Team lead' : r === 'quality' ? 'QA analyst' : r === 'admin' ? 'Admin' : 'Agent';

function Card({ it, today, onDone, onOpen }: { it: Item; today: string; onDone: (msg: string) => void; onOpen: (id: string) => void }) {
  const r = it.request, a = it.actions;
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [overLimit, setOverLimit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: 'approve' | 'reject' | 'forward', overLimitOk = false) => {
    setBusy(true); setErr(null);
    const x = await api<{ moved?: string }>(`/api/leave/approvals/${r.leave_id}`, 'POST', { action, reason, overLimitOk });
    setBusy(false);
    if (x.ok) return onDone(x.data.moved ?? `${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Forwarded'} ${r.leave_id}.`);
    if (x.status === 409 && x.error.startsWith('OVER_LIMIT: ')) return setOverLimit(x.error.slice('OVER_LIMIT: '.length));
    setErr(x.error);
  };
  const byDay = new Map<string, string[]>();
  for (const o of it.othersOff ?? []) byDay.set(o.day, [...(byDay.get(o.day) ?? []), `${o.name}${o.half !== 'full' ? ` (${o.half} half)` : ''}${o.status === 'Pending for approval' || o.status === 'In process' ? ' (waiting)' : ''}`]);
  const noticeOk = (it.noticeGiven ?? 0) >= (it.noticeNeeded ?? 0);
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar name={it.person.name} />
        <div><div style={{ fontWeight: 600 }}>{it.person.name} <span style={{ ...muted, fontWeight: 400 }}>· {ROLE(it.person.role)}{it.tlName ? ` · ${it.tlName}’s team` : ''}</span></div>
          <div style={{ fontSize: 13 }}>{fmtRange(r.start_date, r.end_date, r.start_half, r.end_half)}</div></div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}><StatusBadge status={r.status} /><CopyId id={r.leave_id} /></span>
      </div>
      <div style={{ fontSize: 13, margin: '8px 0', color: 'var(--qa-text-2)' }}>{typeLabel(it.leave, it.lop)} · {fmtQ(it.leave + it.lop)} day{it.leave + it.lop === 1 ? '' : 's'}{it.lop > 0 ? ` (${fmtQ(it.lop)} LOP)` : ''}{r.reason ? <> · “{r.reason}”</> : null}</div>

      {a && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, fontSize: 13, background: 'var(--qa-gray-50)', border: '1px solid var(--qa-border)', borderRadius: 10, padding: '10px 12px' }}>
          <div><span style={muted}>Days away in a row</span><br />{it.stretch}</div>
          <div><span style={muted}>Notice</span><br />Needs {it.noticeNeeded}, gave {it.noticeGiven} <b style={{ color: noticeOk || it.leave === 0 ? 'var(--pass)' : 'var(--fail)' }}>{it.leave === 0 ? '(LOP: no check)' : noticeOk ? '(enough)' : '(short)'}</b></div>
          <div><span style={muted}>Balance now</span><br /><span style={{ color: (it.balance ?? 0) < 0 ? 'var(--fail)' : undefined }}>{fmtQ(it.balance ?? 0)}</span></div>
          <div><span style={muted}>Why it’s at this level</span><br />{it.whyHere || '–'}</div>
          <div><span style={muted}>Waiting since</span><br />{it.waitingSince ? fmtWhen(it.waitingSince) : '–'}</div>
          {byDay.size > 0 && <div style={{ gridColumn: '1 / -1' }}><span style={muted}>Already off those days</span>{[...byDay].map(([d, names]) => <div key={d}><b>{fmtDay(d)}</b>: {names.join(', ')}</div>)}</div>}
        </div>)}
      {a && it.fullHalves && it.fullHalves.length > 0 && <div style={{ marginTop: 8 }}><Banner kind="error">{it.fullHalves.map(f => `${fmtDay(f.day)} ${f.half} half: ${f.count} of ${f.limit} off`).join('. ')}. That day is full.</Banner></div>}
      {a?.approveBlockedWhy && <div style={{ marginTop: 8 }}><Banner kind="info">{a.approveBlockedWhy}</Banner></div>}

      {a && (a.approve || a.reject || a.forward) && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea className={inputCls} placeholder="Write your reason (required for every action)" value={reason} onChange={e => setReason(e.target.value)} />
          {overLimit && <Banner kind="error">{overLimit}</Banner>}
          {err && <Banner kind="error">{err}</Banner>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {a.approve && (overLimit
              ? <button type="button" style={{ ...btnPrimary, opacity: reason.trim() && !busy ? 1 : .5 }} disabled={!reason.trim() || busy} onClick={() => act('approve', true)}>Approve over the limit</button>
              : <button type="button" style={{ ...btnPrimary, opacity: reason.trim() && !busy ? 1 : .5 }} disabled={!reason.trim() || busy} onClick={() => act('approve')}>{a.needsOverLimitOk ? 'Approve…' : 'Approve'}</button>)}
            {a.reject && <button type="button" style={{ ...btnSecondary, opacity: reason.trim() && !busy ? 1 : .5 }} disabled={!reason.trim() || busy} onClick={() => act('reject')}>Reject</button>}
            {a.forward && <button type="button" style={{ ...btnSecondary, opacity: reason.trim() && !busy ? 1 : .5 }} disabled={!reason.trim() || busy} onClick={() => act('forward')}>Forward to an admin</button>}
            <button type="button" style={{ ...btnSecondary, marginLeft: 'auto' }} onClick={() => onOpen(r.leave_id)}>Timeline</button>
          </div>
        </div>)}
      {!a && <div style={{ marginTop: 6 }}><button type="button" style={btnSecondary} onClick={() => onOpen(r.leave_id)}>Timeline</button></div>}
      <span hidden>{today}</span>
    </div>
  );
}

/** Waiting for me, and the ones I've decided. Only the buttons this person may use for this request are shown. */
export default function Approvals({ today, onChanged }: { today: string; onChanged: () => void }) {
  const [tab, setTab] = useState<'waiting' | 'done'>('waiting');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api<{ items: Item[] }>(`/api/leave/approvals?tab=${tab}`); if (r.ok) { setItems(r.data.items); setError(null); } else setError(r.error); }, [tab]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  const done = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); void load(); onChanged(); };
  const tabBtn = (k: 'waiting' | 'done', label: string) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setItems(null); }} style={{ padding: '5px 14px', fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--qa-border)', background: tab === k ? 'var(--qa-text)' : 'var(--qa-card)', color: tab === k ? 'var(--qa-on-text)' : 'var(--qa-text-2)' }}>{label}{k === 'waiting' && items && tab === 'waiting' ? ` · ${items.length}` : ''}</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>{tabBtn('waiting', 'Waiting for me')}{tabBtn('done', 'Done')}</div>
      {toast && <Banner kind="info">{toast}</Banner>}
      {error ? <div style={card}><EmptyState title="Couldn’t load approvals" body={error} /></div> : !items ? <div style={{ ...card, ...muted }}>Loading…</div> : items.length === 0
        ? <div style={card}><EmptyState title={tab === 'waiting' ? 'Nothing is waiting for you' : 'Nothing decided yet'} body={tab === 'waiting' ? 'Requests that need your decision show here, oldest first.' : 'Requests you approve, reject or forward show here.'} /></div>
        : items.map(it => <Card key={it.request.leave_id} it={it} today={today} onDone={done} onOpen={setOpen} />)}
      {open && <RequestDetail id={open} today={today} onClose={() => setOpen(null)} onChanged={() => { void load(); }} />}
    </div>
  );
}
