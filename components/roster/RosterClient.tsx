'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { canGoPrev, shiftAnchor, type RosterView } from '@/lib/roster';
import { CancelDialog, MarkExtraDialog, PatternDialog } from './Dialogs';
import { Avatar, EmptyState, Switch, btnSecondary, dayNum, fmtDay, fmtMonth, fmtShort, wdOf, type Person, type RosterData, type Scheduled } from './ui';

type Tab = 'grid' | 'scheduled' | 'channels';
type Dlg = { t: 'pattern'; p: Person; edit?: Scheduled } | { t: 'mark'; p: Person } | { t: 'cancel'; s: Scheduled } | null;
const CHANNELS = ['Chats', 'Calls', 'Emails', 'ORM'];
const card: React.CSSProperties = { background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 12, overflow: 'hidden' };

export default function RosterClient() {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<RosterView>('week');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('grid');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (v: RosterView, a: string | null) => {
    setError(false);
    try {
      const r = await fetch(`/api/roster?view=${v}${a ? `&date=${a}` : ''}`);
      if (!r.ok) throw new Error();
      const d: RosterData = await r.json();
      setData(d); setAnchor(d.anchor); setView(d.view);
    } catch { setError(true); }
  }, []);
  useEffect(() => {
    let v: RosterView = 'week';
    try { const saved = localStorage.getItem('wint_roster_view'); if (saved === 'day' || saved === 'week' || saved === 'month') v = saved; } catch { /* storage blocked: week */ }
    load(v, null);
  }, [load]);
  const reload = () => load(view, anchor);
  const changeView = (v: RosterView) => { try { localStorage.setItem('wint_roster_view', v); } catch { /* ignore */ } load(v, anchor); };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);

  const done = (msg: string) => { setDlg(null); setToast(msg); reload(); };
  const step = (dir: -1 | 1) => { if (anchor) load(view, shiftAnchor(view, anchor, dir)); };
  const anyEdit = !!data?.people.some(p => p.canEdit);
  const pat = (id: number | null) => data?.patterns.find(p => p.id === id);

  const setChannel = async (p: Person, ch: string, on: boolean) => {
    const channels = on ? [...p.channels, ch] : p.channels.filter(c => c !== ch);
    setData(d => d && { ...d, people: d.people.map(x => x.userId === p.userId ? { ...x, channels } : x) });
    const r = await fetch('/api/roster/channels', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: p.userId, channels }) });
    if (!r.ok) { setToast('Couldn’t save. Try again.'); reload(); }
  };

  const tabBtn = (k: Tab, label: string, count?: number) => (
    <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
      style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--qa-border)', background: tab === k ? 'var(--qa-text)' : 'var(--qa-card)', color: tab === k ? 'var(--qa-on-text)' : 'var(--qa-text-2)' }}>
      {label}{count ? ` · ${count}` : ''}
    </button>);

  let body: React.ReactNode;
  if (error) body = <div style={card}><EmptyState title="Couldn’t load the roster" body="Something went wrong on our side. Try again in a moment." /><div style={{ textAlign: 'center', paddingBottom: 24 }}><button type="button" style={btnSecondary} onClick={() => reload()}>Try again</button></div></div>;
  else if (!data) body = <div style={card} aria-busy="true" aria-label="Loading">{Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ height: 46, borderBottom: '1px solid var(--qa-border-sub)', background: 'var(--qa-gray-50)', opacity: .5 }} />)}</div>;
  else if (!data.people.length) body = <div style={card}><EmptyState title="No one on the roster yet" body="People show here once they are active agents or team leads." /></div>;
  else if (tab === 'grid') {
    const title = data.view === 'day' ? fmtDay(data.days[0]) : data.view === 'week' ? `${fmtShort(data.days[0])} – ${fmtDay(data.days[6])}` : fmtMonth(data.anchor);
    const seg = (v: RosterView, label: string) => (
      <button key={v} type="button" aria-pressed={data.view === v} onClick={() => changeView(v)}
        style={{ padding: '5px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 0, borderLeft: v === 'day' ? 0 : '1px solid var(--qa-border)', background: data.view === v ? 'var(--qa-text)' : 'var(--qa-card)', color: data.view === v ? 'var(--qa-on-text)' : 'var(--qa-text-2)' }}>{label}</button>);
    const toolbar = (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" style={btnSecondary} onClick={() => load(data.view, data.today)}>Today</button>
          <button type="button" style={{ ...btnSecondary, opacity: canGoPrev(data.view, data.anchor) ? 1 : .4 }} aria-label={`Previous ${data.view}`} disabled={!canGoPrev(data.view, data.anchor)} onClick={() => step(-1)}>‹</button>
          <button type="button" style={btnSecondary} aria-label={`Next ${data.view}`} onClick={() => step(1)}>›</button>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--qa-text)', marginLeft: 4 }}>{title}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="roster-legend"><span>Working</span><span><i className="k-off" />Week-off</span><span><i className="k-extra" />Extra day worked</span></div>
          <div role="group" aria-label="Calendar view" style={{ display: 'inline-flex', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>{seg('day', 'Day')}{seg('week', 'Week')}{seg('month', 'Month')}</div>
        </div>
      </div>);

    if (data.view === 'month') {
      const byDay = (i: number) => ({ off: data.people.filter(p => p.cells[i] === 'off'), extra: data.people.filter(p => p.cells[i] === 'extra') });
      const first = data.anchor.slice(0, 7);
      body = (<>{toolbar}
        <div style={card}>
          <div className="roster-month">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="roster-month-h">{w}</div>)}
            {data.days.map((d, i) => {
              const { off, extra } = byDay(i);
              const inMonth = d.slice(0, 7) === first;
              const none = data.people.every(p => p.cells[i] === 'none');
              const chips = [...extra.map(p => ({ p, k: 'extra' })), ...off.map(p => ({ p, k: 'off' }))];
              return (
                <button key={d} type="button" disabled={none} className={`roster-month-c${inMonth ? '' : ' out'}${d === data.today ? ' today' : ''}`} onClick={() => load('day', d)} aria-label={`${fmtDay(d)}: ${off.length} week-off, ${extra.length} extra day`}>
                  <span className="n">{dayNum(d)}</span>
                  {!none && chips.slice(0, 3).map(({ p, k }) => <span key={p.userId} className={`chip k-${k}`}>{p.name.split(' ')[0]}{k === 'extra' ? ' (extra)' : ''}</span>)}
                  {!none && chips.length > 3 && <span className="more">+{chips.length - 3} more</span>}
                </button>);
            })}
          </div>
        </div></>);
    } else {
      const isDay = data.view === 'day';
      const groups = new Map<string, Person[]>();
      for (const p of data.people) { const k = p.tlName ?? ''; groups.set(k, [...(groups.get(k) ?? []), p]); }
      const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
      const cols = 2 + data.days.length + (anyEdit ? 1 : 0);
      const label = (c: string) => c === 'off' ? 'Week-off' : c === 'extra' ? 'Extra day worked' : c === 'none' ? '' : 'Working';
      body = (<>{toolbar}
        <div style={{ ...card, overflowX: 'auto' }}>
          <table className="roster-tbl" style={{ minWidth: isDay ? 640 : 760 }}>
            <thead><tr><th style={{ width: 200 }}>Person</th><th style={{ width: 150 }}>Pattern</th>
              {data.days.map(d => <th key={d} className={`rc${d === data.today ? ' today' : ''}`}>{isDay ? 'Status' : <><div>{wdOf(d)}</div><div>{fmtShort(d)}</div></>}</th>)}
              {anyEdit && <th style={{ width: 200 }}>Actions</th>}</tr></thead>
            <tbody>{order.map(k => (
              <React.Fragment key={k || 'none'}>
                <tr className="grp"><td colSpan={cols}>{k ? `${k}’s team` : 'No team lead assigned'} · {groups.get(k)!.length}</td></tr>
                {groups.get(k)!.map(p => (
                  <tr key={p.userId}>
                    <td><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Avatar name={p.name} /><div><div style={{ fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{p.role === 'tl' ? 'Team lead' : 'Agent'}</div></div></div></td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{p.pattern ? `Pattern ${p.pattern}` : '–'}<div style={{ color: 'var(--qa-text-3)' }}>{pat(p.pattern)?.label}</div></td>
                    {p.cells.map((c, i) => { const d = data.days[i]; return <td key={d} className={`rc k-${c}${d === data.today ? ' today' : ''}${d < data.today ? ' past' : ''}`} title={`${fmtDay(d)}: ${label(c) || 'Not on the roster yet'}`}>{isDay ? label(c) : c === 'off' ? 'Off' : c === 'extra' ? 'Extra' : ''}</td>; })}
                    {anyEdit && <td>{p.canEdit ? <div style={{ display: 'flex', gap: 6 }}><button type="button" style={btnSecondary} onClick={() => setDlg({ t: 'pattern', p })}>Change pattern</button><button type="button" style={btnSecondary} onClick={() => setDlg({ t: 'mark', p })}>Mark</button></div> : <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>–</span>}</td>}
                  </tr>))}
              </React.Fragment>))}</tbody>
          </table>
        </div></>);
    }
  } else if (tab === 'scheduled') {
    body = data.scheduled.length === 0
      ? <div style={card}><EmptyState title="No scheduled changes" body="Pattern changes you set for a future date show here until they start." /></div>
      : (<div style={card}><table className="roster-tbl"><thead><tr><th>Person</th><th>Change</th><th>Starts</th><th>Set by</th>{anyEdit && <th style={{ width: 170 }} />}</tr></thead>
        <tbody>{data.scheduled.map(s => (
          <tr key={s.id}><td style={{ fontWeight: 600 }}>{s.name}</td>
            <td>Pattern {s.from_pattern ?? '–'} → <b>Pattern {s.to_pattern}</b> · {pat(s.to_pattern)?.label}<div style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{s.reason}</div></td>
            <td>{fmtDay(s.starts_on)}</td><td style={{ fontSize: 12 }}>{s.set_by ?? '–'}<div style={{ color: 'var(--qa-text-3)' }}>{new Date(s.set_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div></td>
            {anyEdit && <td>{s.canEdit && <div style={{ display: 'flex', gap: 6 }}><button type="button" style={btnSecondary} onClick={() => { const p = data.people.find(x => x.userId === s.user_id); if (p) setDlg({ t: 'pattern', p, edit: s }); }}>Edit</button><button type="button" style={btnSecondary} onClick={() => setDlg({ t: 'cancel', s })}>Cancel</button></div>}</td>}</tr>))}</tbody></table>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', fontSize: 12, color: 'var(--qa-text-3)' }}><span>Can be edited or cancelled until the start date</span><span>Past days never change</span></div></div>);
  } else {
    body = (<div style={card}><table className="roster-tbl"><thead><tr><th>Person</th><th style={{ width: 160 }}>Role</th>{CHANNELS.map(c => <th key={c} style={{ width: 90 }}>{c}</th>)}</tr></thead>
      <tbody>{data.people.map(p => (<tr key={p.userId}><td style={{ fontWeight: 600 }}>{p.name}</td><td style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{p.role === 'tl' ? 'Team lead' : 'Agent'}{p.tlName ? ` · ${p.tlName}’s team` : ''}</td>
        {CHANNELS.map(c => <td key={c}><Switch label={`${c} for ${p.name}`} on={p.channels.includes(c)} disabled={!p.canEdit} onChange={v => setChannel(p, c, v)} /></td>)}</tr>))}</tbody></table>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', fontSize: 12, color: 'var(--qa-text-3)' }}><span>Channels are for information only. They aren’t used in any leave decision.</span><span>{anyEdit ? 'Changes save straight away and are logged' : 'View only'}</span></div></div>);
  }

  const sub = !data ? '' : data.viewer.role === 'admin' ? 'Everyone’s weekly patterns and extra day marks.' : data.viewer.role === 'tl' ? 'Weekly patterns and extra day marks. You can change people who report to you.' : 'You can view the roster. Changes are made by team leads (own team) and admins.';
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}><h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--qa-text)', margin: 0 }}>Roster</h1>{sub && <div style={{ fontSize: 13, color: 'var(--qa-text-3)', marginTop: 2 }}>{sub}</div>}</div>
      {data && !error && <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>{tabBtn('grid', 'Calendar')}{tabBtn('scheduled', 'Scheduled changes', data.scheduled.length)}{tabBtn('channels', 'Work channels')}</div>}
      {body}
      {data && dlg?.t === 'pattern' && <PatternDialog key={dlg.p.userId + (dlg.edit?.id ?? 0)} person={dlg.p} patterns={data.patterns} today={data.today} edit={dlg.edit} onClose={() => setDlg(null)} onDone={done} />}
      {data && dlg?.t === 'mark' && <MarkExtraDialog person={dlg.p} patterns={data.patterns} days={data.days} today={data.today} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.t === 'cancel' && <CancelDialog s={dlg.s} onClose={() => setDlg(null)} onDone={done} />}
      {toast && <div role="status" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--qa-text)', color: 'var(--qa-on-text)', padding: '10px 16px', borderRadius: 10, fontSize: 13, zIndex: 60 }}>{toast}</div>}
    </div>
  );
}
