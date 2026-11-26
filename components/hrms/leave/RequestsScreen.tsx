'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Banner, Button, CopyId, CountdownDeadline, CountdownFiveMin, DataTable, EmptyState, ErrorState, Field, LoadingState, LopTag, MovedUpTag, PageHeader, QDays, STATUSES, StatusBadge, Timeline, fd, type Col, type TlItem } from '../ui';
import { HRMS_CHANGED } from '../HrmsShell';
import ChangeDialog, { type Act } from './ChangeDialog';
import { api, whenIst } from './api';
import { dayW, fr, halfLabel, sdt } from './format';
import type { Half } from './types';

interface Row {
  leave_id: string; type: string; status: string; applied_at: string; reason: string | null; start_date: string; end_date: string; start_half: Half; end_half: Half;
  with_level: 'tl' | 'admin' | null; reject_code: string | null; reject_note: string | null; cancel_deadline: string | null; window_ends_at: string | null; leave_days: number; lop_days: number; tl_name: string | null;
}
interface Detail {
  request: Row & { user_id: number; with_since: string | null };
  person: { name: string; role: string }; tlName: string | null; owner: boolean; leave: number; lop: number;
  days: { day: string; kind: string; charge: number; half: Half }[];
  events: { at: string; event: string; text: string; reason: string | null; actor: string | null }[];
  ownerActions: { edit: boolean; cancel: boolean; sendToTl: boolean } | null;
}
const TYPES = ['Leave', 'Leave + LOP', 'LOP', 'Extra day worked'];
const typeOf = (r: { leave_days: number; lop_days: number; type?: string }) => r.type === 'extra' ? 'Extra day worked' : r.leave_days > 0 && r.lop_days > 0 ? 'Leave + LOP' : r.lop_days > 0 && r.leave_days === 0 ? 'LOP' : 'Leave';
/** Who has it now: only a request waiting for approval is with a person. Everything else is with no one (the prototype shows a dash). */
const withNow = (r: { status: string; with_level: 'tl' | 'admin' | null }, tlName: string | null) => r.status === 'Pending for approval' ? (r.with_level === 'tl' ? `${tlName ?? 'Your TL'} (TL)` : 'An admin') : null;
/** '19 Nov, 3:06 pm': the prototype's short applied time. */
const appliedShort = (iso: string) => whenIst(iso).replace(/^\w+, /, '').replace(' · ', ', ');
const changed = () => window.dispatchEvent(new Event(HRMS_CHANGED));
const CardHead = ({ t }: { t: string }) => <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}><span className="ov">{t}</span></div>;
const EMPTY = { status: '', type: '', from: '', to: '' };

function ReqFilters({ f, setF }: { f: typeof EMPTY; setF: (f: typeof EMPTY) => void }) {
  return (
    <div className="row" style={{ gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
      <Field label="Status"><select className="input" style={{ width: 220 }} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{STATUSES.map(s => <option key={s[0]}>{s[0]}</option>)}</select></Field>
      <Field label="Type"><select className="input" style={{ width: 200 }} value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="">All types</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      <Field label="From"><input type="date" className="input" style={{ width: 170 }} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
      <Field label="To"><input type="date" className="input" style={{ width: 170 }} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
      {(f.status || f.type || f.from || f.to) && <Button kind="tertiary" size="sm" onClick={() => setF(EMPTY)}>Clear filters</Button>}
    </div>
  );
}

function RequestList({ rows, error, reload }: { rows: Row[] | null; error: string | null; reload: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const shown = useMemo(() => (rows ?? []).filter(r => (!f.status || r.status === f.status) && (!f.type || typeOf(r) === f.type) && (!f.from || r.end_date >= f.from) && (!f.to || r.start_date <= f.to)), [rows, f]);
  if (error) return <div className="card"><ErrorState title="Couldn’t load your requests" body={error} onRetry={reload} /></div>;
  if (!rows) return <div className="card flush"><LoadingState rows={6} /></div>;
  if (!rows.length) return <div className="card"><EmptyState title="No requests yet" body="Leave and extra days you apply for show here, with their status and who they’re with." action="Apply for leave" onAction={() => router.push('/leave')} /></div>;
  const cols: Col<Row & Record<string, unknown>>[] = [
    { key: 'leave_id', label: 'Leave ID', w: 120, render: r => <CopyId id={r.leave_id} /> },
    { key: 'start_date', label: 'Dates', sortable: true, sort: r => r.start_date, render: r => <div><div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.start_date === r.end_date ? fd(r.start_date) : sdt(r.start_date) + ' – ' + fd(r.end_date)}</div><div className="sm12 mut">{halfLabel(r.start_date, r.end_date, r.start_half, r.end_half)}</div></div> },
    { key: 'days', label: 'Days', r: true, w: 70, render: r => <QDays v={r.leave_days + r.lop_days} /> },
    { key: 'type', label: 'Type', w: 130, render: r => typeOf(r) === 'Leave + LOP' ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>Leave <LopTag /></span> : <span style={{ whiteSpace: 'nowrap' }}>{typeOf(r)}</span> },
    { key: 'status', label: 'Status', render: r => <span className="row" style={{ gap: 6 }}><StatusBadge status={r.status} /></span> },
    { key: 'with', label: 'With now', w: 150, render: r => withNow(r, r.tl_name) ? <span className="sm12">{withNow(r, r.tl_name)}</span> : <span className="mut">–</span> },
    { key: 'applied', label: 'Applied', w: 120, render: r => <span className="sm12 mut" style={{ whiteSpace: 'nowrap' }}>{appliedShort(r.applied_at)}</span> },
  ];
  return (
    <>
      <ReqFilters f={f} setF={setF} />
      {!shown.length
        ? <div className="card"><EmptyState title="No requests match these filters" body="Try a different status, type or date range." action="Clear filters" onAction={() => setF(EMPTY)} /></div>
        : <DataTable columns={cols} rows={shown as (Row & Record<string, unknown>)[]} onRow={r => router.push(`/leave/requests?req=${r.leave_id}`)} foot={<><span>{shown.length} of {rows.length} requests</span><span>Dates and times in IST</span></>} />}
    </>
  );
}

const dayWord = (k: string, charge: number, half: Half) => {
  const hp = charge > 0 && charge < 1 ? (half === 'second' ? ', second half' : ', first half') : '';
  return k === 'leave' ? 'Leave' + hp : k === 'lop' ? 'LOP' + hp : k === 'leave+lop' ? 'Leave and LOP' : k === 'weekoff' ? 'Week-off' : k === 'cancelled' ? 'Cancelled' : '–';
};
const stateOf = (status: string, k: string, day: string, today: string) => {
  if (k === 'weekoff' || k === 'none') return '–';
  if (['Cancelled', 'Auto-cancelled', 'Cancelled (exit)'].includes(status) || k === 'cancelled') return 'Cancelled';
  if (status === 'Rejected' || status === 'Auto-rejected') return 'Not taken';
  if (status === 'Approved' || status === 'Auto-approved' || status === 'Taken') return day < today ? 'Taken' : 'Upcoming';
  return 'Waiting';
};
const KIND: Record<string, TlItem['k']> = { approved: 'ok', auto_approved: 'ok', rejected: 'no', auto_rejected: 'no', cancelled: 'no', auto_cancelled: 'no', moved_up: 'up', forwarded: 'up', sent: 'up' };

function RequestDetail({ id, today }: { id: string; today: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<Act | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api<Detail>(`/api/leave/requests/${id}`); if (r.ok) { setD(r.data); setError(null); } else setError(r.error); }, [id]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  const ends = d?.request.status === 'In process' ? d.request.window_ends_at : null;
  useEffect(() => { if (!ends) return; const t = setTimeout(() => { void load(); changed(); }, Math.max(0, Date.parse(ends) - Date.now()) + 1500); return () => clearTimeout(t); }, [ends, load]);
  const back = <Link className="b14" href="/leave/requests">‹ My requests</Link>;
  if (error) return <><div style={{ marginBottom: 20 }}>{back}</div><div className="card"><ErrorState title={/not found/i.test(error) ? 'Request not found' : 'Couldn’t load this request'} body={/not found/i.test(error) ? `There’s no request ${id} that you can open.` : error} onRetry={load} /></div></>;
  if (!d) return <><div style={{ marginBottom: 20 }}>{back}</div><div className="card flush"><LoadingState rows={6} /></div></>;
  const r = d.request, a = d.ownerActions, charged = d.leave + d.lop, type = typeOf({ leave_days: d.leave, lop_days: d.lop });
  const who = withNow(r, d.tlName);
  const done = (msg: string) => { setDlg(null); setToast(msg); setTimeout(() => setToast(null), 3000); void load(); changed(); };
  const mine = d.owner;
  const live = ['In process', 'Pending for approval', 'Auto-rejected', 'Approved', 'Auto-approved'].includes(r.status);
  const items: TlItem[] = d.events.map((e, i, all) => ({ t: e.text, at: whenIst(e.at, true) + ' IST', who: e.actor, reason: e.reason, k: KIND[e.event], now: live && i === all.length - 1 }));
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>{back}</div>
      <div className="col" style={{ gap: 6, marginBottom: 24 }}>
        <h2 className="dh">{fr(r.start_date, r.end_date)}</h2>
        <div className="row" style={{ gap: 10 }}><CopyId id={r.leave_id} /><StatusBadge status={r.status} />{d.lop > 0 && <LopTag />}{d.events.some(e => e.event === 'moved_up') && r.status === 'Pending for approval' && <MovedUpTag />}<span className="sm12 mut">{type} · {halfLabel(r.start_date, r.end_date, r.start_half, r.end_half)} · {dayW(charged)}{!mine && ` · ${d.person.name}`}</span></div>
      </div>
      <div className="hgrid">
        <div className="col" style={{ gap: 20 }}>
          {mine && <div className="card"><CardHead t="What you can do" />
            {r.status === 'In process' && r.window_ends_at ? <div className="col"><CountdownFiveMin endsAt={r.window_ends_at} /><div className="row">{a?.edit && <Button kind="secondary" size="sm" onClick={() => setDlg('edit')}>Edit</Button>}{a?.cancel && <Button kind="secondary" size="sm" onClick={() => setDlg('cancel')}>Cancel</Button>}</div></div>
              : r.status === 'Auto-rejected' && a ? <div className="col"><Banner kind="error">{r.reject_note}</Banner>{r.cancel_deadline && <CountdownDeadline deadline={r.cancel_deadline} />}<div className="row">{a.cancel && <Button kind="secondary" size="sm" onClick={() => setDlg('cancel')}>Cancel</Button>}{a.sendToTl && <Button size="sm" onClick={() => setDlg('send')}>Send to TL</Button>}</div></div>
                : a && (a.edit || a.cancel) ? <div className="col"><div className="row">{a.edit && <Button kind="secondary" size="sm" onClick={() => setDlg('edit')}>Edit</Button>}{a.cancel && <Button kind="secondary" size="sm" onClick={() => setDlg('cancel')}>Cancel</Button>}</div>{(r.status === 'Approved' || r.status === 'Auto-approved') && <div className="sm12 mut">You’ll see a warning before any change, and you’ll need to click Okay.</div>}</div>
                  : <div className="b14 mut">Nothing to change. This request is read only.</div>}
          </div>}
          {d.lop > 0 && d.leave >= 0 && <Banner kind="warn"><b>{dayW(d.lop)} of this is unpaid (LOP)</b><div>{d.leave > 0 ? `${dayW(d.leave)} come off the leave balance and ${dayW(d.lop)} are LOP.` : 'Your balance was already at its limit, so these days are LOP.'}</div></Banner>}
          <div className="card flush"><div style={{ padding: '16px 20px 8px' }}><span className="ov">Day by day</span></div>
            <table className="tbl"><thead><tr><th>Date</th><th>Counts as</th><th className="r">Days</th><th>State</th></tr></thead>
              <tbody>{d.days.map(x => <tr key={x.day}><td>{fd(x.day)}</td><td>{x.kind === 'weekoff' || x.kind === 'none' || x.kind === 'cancelled' ? <span className="mut">{dayWord(x.kind, x.charge, x.half)}</span> : dayWord(x.kind, x.charge, x.half)}</td><td className="r"><QDays v={x.charge} /></td><td className="sm12 mut">{stateOf(r.status, x.kind, x.day, today)}</td></tr>)}</tbody></table></div>
          <div className="card"><CardHead t="Timeline" /><Timeline items={items} /></div>
        </div>
        <div className="col" style={{ gap: 20 }}>
          <div className="card"><CardHead t="With now" />
            {who ? <div className="col" style={{ gap: 10 }}><div className="row" style={{ gap: 10 }}><Avatar name={who.split(' (')[0]} /><div><div className="b14" style={{ fontWeight: 600 }}>{who.split(' (')[0]}</div><div className="sm12 mut">{(who.split(' (')[1] ?? '').replace(')', '')}{r.with_since ? `${who.includes(' (') ? ' · ' : ''}since ${whenIst(r.with_since)}` : ''}</div></div></div>
              <div className="sm12 mut">{r.with_level === 'tl' ? 'Your TL can approve, reject or forward it to an admin.' : 'An admin makes the final decision.'}</div></div>
              : <div className="b14 mut">{r.status === 'In process' ? 'No one yet. The system checks it after 5 minutes.' : r.status === 'Auto-rejected' ? 'No one. Cancel it or send it to your TL by 11:59 pm IST today.' : 'No one. This request is decided.'}</div>}
          </div>
          <div className="card"><CardHead t="Details" />
            <dl className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
              <dt>Type</dt><dd>{type}</dd><dt>Full or half</dt><dd>{halfLabel(r.start_date, r.end_date, r.start_half, r.end_half)}</dd><dt>Days charged</dt><dd>{dayW(charged)}</dd>
              <dt>Reason</dt><dd>{r.reason || '–'}</dd><dt>Applied</dt><dd>{whenIst(r.applied_at, true)} IST</dd>
            </dl></div>
        </div>
      </div>
      {dlg && <ChangeDialog req={{ leave_id: r.leave_id, status: r.status, start_date: r.start_date, end_date: r.end_date, start_half: r.start_half, end_half: r.end_half }} act={dlg} onClose={() => setDlg(null)} onDone={done} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

/** My requests (prototype page-requests.jsx): the list with filters, and one request's page. */
export default function RequestsScreen({ openId }: { openId: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState('');
  const load = useCallback(async () => { const r = await api<{ requests: Row[] }>('/api/leave/requests'); if (r.ok) { setRows(r.data.requests); setError(null); } else setError(r.error); }, []);
  useEffect(() => { queueMicrotask(() => { void load(); void api<{ today: string }>('/api/leave/me').then(m => { if (m.ok) setToday(m.data.today); }); }); const h = () => { void load(); }; window.addEventListener(HRMS_CHANGED, h); return () => window.removeEventListener(HRMS_CHANGED, h); }, [load]);
  if (openId) return <div className="page"><RequestDetail key={openId} id={openId} today={today} /></div>;
  return <div className="page"><PageHeader title="My requests" sub="Every leave and extra day you’ve asked for, with its status and who it’s with now." /><RequestList rows={rows} error={error} reload={load} /></div>;
}
