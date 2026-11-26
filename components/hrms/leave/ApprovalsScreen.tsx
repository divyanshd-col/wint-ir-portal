'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Avatar, Banner, Button, CopyId, DataTable, EmptyState, ErrorState, Field, LoadingState, LopTag, MovedUpTag, PageHeader, QDays, StatusBadge, Tabs, WarningDialog, cx, fd, type Col } from '../ui';
import { HRMS_CHANGED } from '../HrmsShell';
import { api, whenIst } from './api';
import { dayW, fr, halfLabel } from './format';
import type { Half } from './types';

interface Item {
  request: { leave_id: string; user_id: number; status: string; applied_at: string; reason: string | null; start_date: string; end_date: string; start_half: Half; end_half: Half; with_level: 'tl' | 'admin' | null; with_since: string | null; sent_to_tl: boolean };
  person: { name: string; role: string }; tlName: string | null; leave: number; lop: number;
  stretch?: number; fullHalves?: { day: string; half: string; count: number; limit: number }[];
  actions?: { approve: boolean; reject: boolean; forward: boolean; approveBlockedWhy?: string; needsOverLimitOk?: boolean };
  noticeNeeded?: number; noticeGiven?: number; whyHere?: string; balance?: number; waitingSince?: string | null;
  othersOff?: { name: string; day: string; half: string; status: string }[];
  offByDay?: { day: string; holiday: string | null; first: { count: number; limit: number | null }; second: { count: number; limit: number | null } }[];
}
type Act = 'approve' | 'reject' | 'forward';
const ROLE = (r: string) => r === 'tl' ? 'Team lead' : r === 'quality' ? 'QA analyst' : r === 'admin' ? 'Admin' : 'Agent';
const typeOf = (leave: number, lop: number) => leave > 0 && lop > 0 ? 'Leave + LOP' : lop > 0 ? 'LOP' : 'Leave';
const red = { color: 'var(--red-300)', boxShadow: 'inset 0 0 0 1px var(--red-600)' };
const green = { color: 'var(--green-400)', boxShadow: 'inset 0 0 0 1px var(--green-700)' };
const since = (iso?: string | null) => iso ? whenIst(iso).replace(/^\w+, /, '').replace(' · ', ', ') : '–';
const changed = () => window.dispatchEvent(new Event(HRMS_CHANGED));

function ListItem({ it, on, onClick, done }: { it: Item; on: boolean; onClick: () => void; done?: boolean }) {
  const r = it.request;
  return (
    <button type="button" className={cx('apli', on && 'on')} onClick={onClick}><Avatar name={it.person.name} />
      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, justifyContent: 'space-between', flexWrap: 'nowrap' }}><b className="b14" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.person.name}</b><span className="mono sm12 mut">{r.leave_id}</span></div>
        <span className="sm12" style={{ color: '#e5e5e5' }}>{fr(r.start_date, r.end_date)}{r.start_half !== 'full' && r.start_date === r.end_date ? ' · ' + (r.start_half === 'first' ? 'First half' : 'Second half') : ''}</span>
        <span className="row" style={{ gap: 6 }}>{done ? <span className="chip yes">Decided</span> : null}{it.lop > 0 && <LopTag />}{(it.fullHalves?.length ?? 0) > 0 && <span className="tag" style={red}>Day full</span>}</span>
        <span className="sm12 mut">Waiting since {since(r.with_since)}</span>
      </div></button>
  );
}

function OffTable({ it }: { it: Item }) {
  const role = it.person.role === 'tl' ? 'TLs' : 'agents';
  const by = new Map<string, string[]>();
  for (const o of it.othersOff ?? []) by.set(o.day, [...(by.get(o.day) ?? []), `${o.name}|${o.half}|${o.status}`]);
  const cell = (c: { count: number; limit: number | null }, half: string) => c.limit == null ? <span className="mut">Limit off</span>
    : <span className="row" style={{ gap: 6 }}><b className="qd" style={{ color: c.count >= c.limit ? 'var(--red-300)' : '#fff' }}>{c.count} of {c.limit}</b><span className="sm12">{role} off, {half} half</span>{c.count >= c.limit && <span className="tag" style={red}>Full</span>}</span>;
  return (
    <div className="card flush"><div style={{ padding: '16px 20px 8px' }}><span className="ov">Already off on these dates</span></div>
      <table className="tbl"><thead><tr><th style={{ width: 170 }}>Date</th><th>First half</th><th>Second half</th><th>Who else is off</th></tr></thead>
        <tbody>{(it.offByDay ?? []).map(d => {
          const others = (by.get(d.day) ?? []).map(x => x.split('|'));
          return <tr key={d.day}><td style={{ whiteSpace: 'nowrap' }}>{fd(d.day)}{d.holiday && <div className="sm12" style={{ color: 'var(--purple-300)' }}>{d.holiday}</div>}</td><td>{cell(d.first, 'first')}</td><td>{cell(d.second, 'second')}</td>
            <td className="sm12">{others.length ? others.slice(0, 4).map(([n, h, st], i) => <div key={i} className="row" style={{ gap: 6 }}>{n} <span className="mut">· {h === 'full' ? 'Full day' : h === 'first' ? 'First half' : 'Second half'}</span><span className="mut">· {st}</span></div>) : <span className="mut">No one</span>}{others.length > 4 && <div className="mut">and {others.length - 4} more</div>}</td></tr>;
        })}</tbody></table></div>
  );
}

const LABEL: Record<Act, string> = { approve: 'Approve', reject: 'Reject', forward: 'Forward to an admin' };
function ActionPanel({ it, onDone }: { it: Item; onDone: (msg: string) => void }) {
  const r = it.request, a = it.actions;
  const [act, setAct] = useState<Act | null>(null);
  const [reason, setReason] = useState('');
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!a || !(a.approve || a.reject || a.forward)) return <div className="b14 mut">You can’t act on this one.</div>;
  const over = !!a.needsOverLimitOk;
  const label = (x: Act) => x === 'approve' && over ? 'Approve over the limit' : LABEL[x];
  const first = it.person.name.split(' ')[0];
  const fin = async (ok = false) => {
    if (!act) return;
    setBusy(true); setErr(null);
    const x = await api<{ moved?: string }>(`/api/leave/approvals/${r.leave_id}`, 'POST', { action: act, reason, overLimitOk: ok });
    setBusy(false); setWarn(false);
    if (x.ok) return onDone(x.data.moved ?? `${act === 'approve' ? 'Approved' : act === 'reject' ? 'Rejected' : 'Forwarded'}. ${act === 'forward' ? '' : `${first} is told.`}`.trim());
    if (x.status === 409 && x.error.startsWith('OVER_LIMIT: ')) return setErr(x.error.slice('OVER_LIMIT: '.length));
    setErr(x.error);
  };
  const submit = () => { if (act === 'approve' && over) setWarn(true); else void fin(); };
  const acts = (['approve', 'reject', 'forward'] as Act[]).filter(x => a[x]);
  return (
    <div className="col" style={{ gap: 14 }}>
      {err && <Banner kind="error">{err}</Banner>}
      {(it.fullHalves?.length ?? 0) > 0 && !over && <Banner kind="error">Limit crossed for this day. Please reach out to your Sr TL.</Banner>}
      {a.approveBlockedWhy && <Banner kind="info">{a.approveBlockedWhy}</Banner>}
      <div className="row">{acts.map(x => <Button key={x} kind={act === x ? 'primary' : 'secondary'} size="sm" onClick={() => { setAct(x); setErr(null); }}>{label(x)}</Button>)}</div>
      {act && <div className="col" style={{ gap: 12, paddingTop: 4 }}>
        <Field label="Reason" req help={reason.trim() ? `${first} sees this reason.` : 'Required. The button stays off until it’s filled.'}><textarea className="input" placeholder="Write your reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button kind="secondary" size="sm" onClick={() => setAct(null)}>Go back</Button><Button size="sm" disabled={!reason.trim() || busy} onClick={submit}>{label(act)}</Button></div></div>}
      {warn && <WarningDialog title="This day is full" busy={busy} onOk={() => void fin(true)} onCancel={() => setWarn(false)}>{(it.fullHalves ?? []).map(f => `${fd(f.day)}, ${f.half} half: ${f.count} of ${f.limit} are already off. Approving puts it at ${f.count + 1} of ${f.limit}.`).join(' ')}</WarningDialog>}
    </div>
  );
}

const Fact = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="pvrow" style={{ gridTemplateColumns: '170px 1fr' }}><div className="mut">{k}</div><div>{children}</div></div>;
function Detail({ it, onDone }: { it: Item; onDone: (msg: string) => void }) {
  const r = it.request, charged = it.leave + it.lop;
  const holder = r.with_level === 'tl' ? `${it.tlName ?? 'the TL'} (TL)` : 'an admin';
  const noticeOk = (it.noticeGiven ?? 0) >= (it.noticeNeeded ?? 0);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card col" style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap', minWidth: 0, flex: 1 }}><Avatar name={it.person.name} />
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}><span className="h2s">{it.person.name}</span><span className="sm12 mut">{ROLE(it.person.role)}{it.tlName ? ` · ${it.tlName}’s team` : ''}</span></div>
              <div className="dh" style={{ fontSize: 22, lineHeight: '28px', display: 'block' }}>{fr(r.start_date, r.end_date)}</div>
              <div className="row sm12 mut" style={{ gap: 8 }}><CopyId id={r.leave_id} /><span>{typeOf(it.leave, it.lop)} · {halfLabel(r.start_date, r.end_date, r.start_half, r.end_half)} · {dayW(charged)}</span></div></div></div>
          <div className="row" style={{ gap: 6 }}><StatusBadge status={r.status} />{it.lop > 0 && <LopTag />}{it.whyHere?.toLowerCase().includes('moved') && <MovedUpTag />}</div></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{it.whyHere && <span className="chip" style={{ whiteSpace: 'normal', height: 'auto', padding: '2px 8px' }}>{it.whyHere.replace(/^(Sent|Forwarded) to [^.]*\.\s*/, '')}</span>}<span className="sm12 mut" style={{ minWidth: 0 }}>With {holder} since {since(r.with_since)}</span></div>
        <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14 }}><ActionPanel key={r.leave_id} it={it} onDone={onDone} /></div>
      </div>
      <div className="card" style={{ padding: '8px 20px 12px' }}>
        <Fact k="Reason">{r.reason || '–'}</Fact>
        {it.stretch != null && <Fact k="Days away in a row"><b>{dayW(it.stretch)}</b></Fact>}
        {it.noticeNeeded != null && <Fact k="Notice">{it.leave === 0 ? <span className="mut">No notice check for LOP</span> : <>Needs {dayW(it.noticeNeeded)} · gave {dayW(it.noticeGiven ?? 0)} {noticeOk ? <span className="tag" style={green}>Enough</span> : <span className="tag" style={red}>Too short</span>}</>}</Fact>}
        {it.balance != null && <Fact k="Balance now"><QDays v={it.balance} /><span className="sm12 mut"> · this request: {dayW(it.leave)} leave, {dayW(it.lop)} LOP</span></Fact>}
      </div>
      {(it.offByDay?.length ?? 0) > 0 && <OffTable it={it} />}
      <Link className="b14" href={`/leave/requests?req=${r.leave_id}`}>Open the full request and timeline</Link>
    </div>
  );
}

const TABS = [{ k: 'waiting', label: 'Waiting for me' }, { k: 'done', label: 'Done' }];

/** Approvals (prototype page-approvals.jsx): the list on the left, the selected request on the right with the buttons this person may use. */
export default function ApprovalsScreen() {
  const [tab, setTab] = useState<'waiting' | 'done'>('waiting');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api<{ items: Item[] }>(`/api/leave/approvals?tab=${tab}`); if (r.ok) { setItems(r.data.items); setError(null); } else setError(r.error); }, [tab]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  const head = <PageHeader title="Approvals" sub="Requests waiting at your level, oldest first. Only the buttons you can use are shown." />;
  const tabs = TABS.map(t => ({ ...t, count: t.k === 'waiting' && tab === 'waiting' && items ? items.filter(i => !decided[i.request.leave_id]).length : undefined }));
  const switchTab = (k: string) => { setTab(k as 'waiting' | 'done'); setItems(null); setSel(null); };
  const done = (msg: string) => { if (sel) setDecided(d => ({ ...d, [sel]: true })); setToast(msg); setTimeout(() => setToast(null), 3500); void load(); changed(); };
  let body: React.ReactNode;
  if (error) body = <div className="card"><ErrorState title="Couldn’t load approvals" body={error} onRetry={load} /></div>;
  else if (!items) body = <div className="card flush"><LoadingState rows={6} /></div>;
  else if (tab === 'done') {
    const cols: Col<{ id: string; name: string; dates: string; reason: string; status: string; with: string } & Record<string, unknown>>[] = [
      { key: 'id', label: 'Leave ID', w: 120, render: r => <Link href={`/leave/requests?req=${r.id}`} className="mono">{r.id}</Link> },
      { key: 'name', label: 'Person', w: 170 }, { key: 'dates', label: 'Dates', render: r => <span className="sm12">{r.dates}</span> },
      { key: 'status', label: 'Status now', w: 180, render: r => <StatusBadge status={r.status} /> }, { key: 'reason', label: 'Their reason', render: r => <span className="sm12 mut">{r.reason}</span> },
    ];
    body = !items.length ? <div className="card"><EmptyState title="Nothing decided yet" body="Requests you approve, reject or forward show here." /></div>
      : <DataTable columns={cols} rows={items.map(i => ({ id: i.request.leave_id, name: i.person.name, dates: fr(i.request.start_date, i.request.end_date), status: i.request.status, reason: i.request.reason ?? '–', with: '' }))} foot={<><span>{items.length} decisions</span><span>For reference only</span></>} />;
  } else if (!items.length) body = <div className="card"><EmptyState title="Nothing waiting for you" body="New requests show here, oldest first. You’ll also get a message on the HRMS." /></div>;
  else {
    const cur = items.find(i => i.request.leave_id === sel) ?? items[0];
    body = (
      <div className="apgrid"><div className="card flush aplist">{items.map(i => <ListItem key={i.request.leave_id} it={i} on={i.request.leave_id === cur.request.leave_id} done={decided[i.request.leave_id]} onClick={() => setSel(i.request.leave_id)} />)}
        <div className="tfoot"><span>{items.length} {items.length === 1 ? 'request' : 'requests'} · oldest first</span></div></div>
        <div style={{ minWidth: 0 }}><Detail key={cur.request.leave_id} it={cur} onDone={done} /></div></div>
    );
  }
  return <div className="page">{head}<div style={{ marginBottom: 20 }}><Tabs tabs={tabs} value={tab} onChange={switchTab} /></div>{body}{toast && <div className="toast" role="status">{toast}</div>}</div>;
}
