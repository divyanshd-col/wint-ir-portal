'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { canGoPrev, filterPeople, NO_FILTER, shiftAnchor, type RosterFilter, type RosterView } from '@/lib/roster';
import { dayNum, fmtMonth, fmtShort, offShort, roleLabel, wdOf, type Person, type RosterData, type Scheduled } from '@/components/roster/ui';
import { Button, DataTable, EmptyState, ErrorState, Ico, Legend, LoadingState, PageHeader, QDays, Tabs, Toggle, cx, fd } from '../ui';
import RosterFilters, { validFilter } from './RosterFilters';
import { CancelDialog, MarkExtraDialog, PatternDialog, StatementDialog, TeamLeadDialog } from './RosterDialogs';

type Tab = 'grid' | 'scheduled' | 'skills' | 'teams';
type Dlg = { t: 'pattern'; p: Person; edit?: Scheduled } | { t: 'mark'; p: Person } | { t: 'cancel'; s: Scheduled } | { t: 'tl'; p: Person; tl: Person } | { t: 'statement'; p: Person } | null;
const CHANNELS = ['Chats', 'Calls', 'Emails', 'ORM'];
const SHORT: Record<string, string> = { off: 'Off', extra: 'Extra', leave: 'Leave', 'leave-half': '½ Leave', lop: 'LOP', 'lop-half': '½ LOP', hol: 'Hol' };
const CELL_CLASS: Record<string, string> = { off: 'k-off', extra: 'k-extra', leave: 'k-leave', 'leave-half': 'k-leave', lop: 'k-lop', 'lop-half': 'k-lop', hol: 'k-hol', work: 'k-work', none: 'k-work' };
const isLeave = (c: string) => c === 'leave' || c === 'leave-half' || c === 'lop' || c === 'lop-half';

/** The Roster page, in the prototype's markup (page-roster.jsx). Day, Week and Month views and the filters are additions. */
export default function RosterScreen() {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<RosterView>('week');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('grid');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<RosterFilter>(NO_FILTER);

  const load = useCallback(async (v: RosterView, a: string | null) => {
    try {
      const r = await fetch(`/api/roster?view=${v}${a ? `&date=${a}` : ''}`);
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({})))?.error as string | undefined;
        setError(r.status === 403 ? 'You don’t have access to the roster.' : msg || 'Something went wrong on our side. Try again in a moment.');
        return;
      }
      const d: RosterData = await r.json();
      setError(null); setData(d); setAnchor(d.anchor); setView(d.view);
    } catch { setError('Couldn’t reach the server. Try again in a moment.'); }
  }, []);
  useEffect(() => {
    let v: RosterView = 'week';
    try { const saved = localStorage.getItem('wint_roster_view'); if (saved === 'day' || saved === 'week' || saved === 'month') v = saved; } catch { /* storage blocked: week */ }
    queueMicrotask(() => { void load(v, null); });
  }, [load]);
  const reload = () => load(view, anchor);
  const changeView = (v: RosterView) => { try { localStorage.setItem('wint_roster_view', v); } catch { /* ignore */ } load(v, anchor); };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
  const done = (msg: string) => { setDlg(null); setToast(msg); reload(); };
  const step = (dir: -1 | 1) => { if (anchor) load(view, shiftAnchor(view, anchor, dir)); };
  const anyEdit = !!data?.people.some(p => p.canEdit);
  const activeFilter = useMemo(() => (data ? validFilter(filter, data.people) : filter), [data, filter]);
  const shown = useMemo(() => (data ? filterPeople(data.people, activeFilter) : []), [data, activeFilter]);
  const pat = (id: number | null) => data?.patterns.find(p => p.id === id);
  const tname = (id: number | null) => (id === null ? '–' : pat(id)?.rotates === false ? 'Fixed' : `Type ${id}`);
  const setChannel = async (p: Person, ch: string, on: boolean) => {
    const channels = on ? [...p.channels, ch] : p.channels.filter(c => c !== ch);
    setData(d => d && { ...d, people: d.people.map(x => (x.userId === p.userId ? { ...x, channels } : x)) });
    const r = await fetch('/api/roster/channels', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: p.userId, channels }) });
    if (!r.ok) { setToast('Couldn’t save. Try again.'); reload(); }
  };

  const sub = !data ? '' : data.viewer.role === 'admin' ? 'Everyone’s rotating roster, leave, holidays and extra day marks. Everyone moves to the next type every Monday.'
    : data.viewer.role === 'tl' ? 'Your team’s rotating roster, leave, holidays and extra day marks. You can change people who report to you.'
    : 'You can view the roster. Changes are made by team leads (own team) and admins.';
  const typeCell = (p: Person) => p.pattern ? <>{tname(p.pattern)}<div className="mut">{offShort(pat(p.pattern))}</div></> : <span className="mut">Not set</span>;
  const noMatch = <div className="card"><EmptyState title="No one matches these filters" body="Try a different search or clear the filters." action="Clear filters" onAction={() => setFilter(NO_FILTER)} /></div>;

  let body: React.ReactNode;
  if (error) body = <div className="card"><ErrorState title="Couldn’t load the roster" body={error} onRetry={() => reload()} /></div>;
  else if (!data) body = <div className="card flush"><LoadingState rows={8} /></div>;
  else if (!data.people.length) body = <div className="card"><EmptyState title="No one on the roster yet" body="People show here once they are active agents or team leads." /></div>;
  else if (tab === 'grid') {
    const title = data.view === 'day' ? fd(data.days[0]) : data.view === 'week' ? `${fmtShort(data.days[0])} – ${fd(data.days[6])}` : fmtMonth(data.anchor);
    const prevOk = canGoPrev(data.view, data.anchor);
    const toolbar = (
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <Button kind="secondary" size="sm" onClick={() => load(data.view, data.today)}>Today</Button>
          <button type="button" className="iconbtn" aria-label={`Previous ${data.view}`} disabled={!prevOk} onClick={() => step(-1)}><span style={{ transform: 'rotate(180deg)', display: 'grid' }}><Ico n="chev" /></span></button>
          <button type="button" className="iconbtn" aria-label={`Next ${data.view}`} onClick={() => step(1)}><Ico n="chev" /></button>
          <span className="h2s">{title}</span>
        </div>
        <div className="row" style={{ gap: 20 }}>
          <Legend items={[['k-work', 'Working'], ['k-off', 'Week-off'], ...(data.leaveReady ? [['k-leave', 'Leave'], ['k-lop', 'LOP'], ['k-hol', 'Holiday']] as [string, string][] : []), ['k-extra', 'Extra day worked']]} />
          <div className="seg" role="group" aria-label="Calendar view">{(['day', 'week', 'month'] as RosterView[]).map(v => <button key={v} type="button" aria-pressed={data.view === v} className={data.view === v ? 'on' : ''} onClick={() => changeView(v)}>{v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}</button>)}</div>
        </div>
      </div>);
    const filters = <RosterFilters people={data.people} patterns={data.patterns} view={data.view} leaveReady={data.leaveReady} value={activeFilter} onChange={setFilter} shown={shown.length} />;

    if (data.view === 'month') {
      const first = data.anchor.slice(0, 7);
      const weeks = data.days.length / 7;
      body = (<>{toolbar}{filters}
        {shown.length === 0 ? noMatch : (
          <div className="card" style={{ padding: 16 }}>
            <div className="tcal" style={{ marginBottom: 6 }}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="calw">{w}</div>)}</div>
            <div className="tcal" style={{ gridTemplateRows: `repeat(${weeks}, auto)` }}>
              {data.days.map((d, i) => {
                const off = shown.filter(p => p.cells[i] === 'off').length, extra = shown.filter(p => p.cells[i] === 'extra').length, leave = shown.filter(p => isLeave(p.cells[i])).length;
                const holiday = data.holidays.find(h => h.day === d)?.name;
                const none = shown.every(p => p.cells[i] === 'none');
                return (
                  <button key={d} type="button" className="calbtn" disabled={none} onClick={() => load('day', d)} aria-label={`${fd(d)}: ${off} week-off, ${leave} on leave, ${extra} extra day${holiday ? `, ${holiday}` : ''}`}>
                    <div className={cx('dc', 'tdc', d === data.today && 'today', d.slice(0, 7) !== first && 'out')}>
                      <div className="dn"><span className="d">{dayNum(d)}</span><small title={holiday ?? undefined}>{holiday && !none ? holiday : wdOf(d)}</small></div>
                      {!none && extra > 0 && <div className="h k-extra"><em>Extra</em><b>{extra}</b></div>}
                      {!none && leave > 0 && <div className="h k-leave"><em>Leave</em><b>{leave}</b></div>}
                      {!none && off > 0 && <div className="h k-off"><em>Week-off</em><b>{off}</b></div>}
                    </div>
                  </button>);
              })}
            </div>
          </div>)}
      </>);
    } else {
      const isDay = data.view === 'day';
      const groups = new Map<string, Person[]>();
      for (const p of shown) { const k = p.tlName ?? ''; groups.set(k, [...(groups.get(k) ?? []), p]); }
      const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
      const showBalance = data.people.some(p => p.balance !== null); // whole list, so the columns do not jump while filtering
      const cols = 2 + data.days.length + (showBalance ? 1 : 0) + (anyEdit ? 1 : 0);
      const hol = (d: string) => data.holidays.find(h => h.day === d)?.name;
      const label = (c: string, d: string) => ({ off: 'Week-off', extra: 'Extra day worked', none: '', leave: 'Leave', 'leave-half': 'Half-day leave', lop: 'LOP', 'lop-half': 'Half-day LOP', hol: `Holiday${hol(d) ? `: ${hol(d)}` : ''}`, work: 'Working' } as Record<string, string>)[c] ?? '';
      body = (<>{toolbar}{filters}
        {shown.length === 0 ? noMatch : (
          <div className="card flush" style={{ overflowX: 'auto' }}>
            <table className="tbl rt" style={{ minWidth: isDay ? 640 : 760 }}>
              <thead><tr><th style={{ width: 200 }}>Person</th><th style={{ width: 130 }}>Roster type</th>
                {data.days.map(d => <th key={d} className={cx('rc', d === data.today && 'today')}>{isDay ? 'Status' : <><div>{wdOf(d)}</div><div>{fmtShort(d)}</div></>}</th>)}
                {showBalance && <th className="r" style={{ width: 90 }}>Balance</th>}{anyEdit && <th style={{ width: 200 }}>Actions</th>}</tr></thead>
              <tbody>{order.map(k => (
                <React.Fragment key={k || 'none'}>
                  <tr className="grp"><td colSpan={cols}>{k ? `${k}’s team` : 'No team lead assigned'} · {groups.get(k)!.length}</td></tr>
                  {groups.get(k)!.map(p => (
                    <tr key={p.userId}>
                      <td className="rsn"><div className="b14" style={{ fontWeight: 600 }}>{p.name}</div><div className="sm12 mut">{roleLabel(p.role)}</div></td>
                      <td className="sm12" style={{ whiteSpace: 'nowrap' }}>{typeCell(p)}</td>
                      {p.cells.map((c, i) => { const d = data.days[i]; return <td key={d} className={cx('rc', CELL_CLASS[c], d === data.today && 'today', d < data.today && 'past')} title={`${fd(d)}: ${label(c, d) || 'No roster type set'}`}>{isDay ? label(c, d) : SHORT[c] ?? ''}</td>; })}
                      {showBalance && <td className="r">{p.balance === null ? <span className="mut">–</span> : <button type="button" className="rbal" title="Open statement" onClick={() => setDlg({ t: 'statement', p })}><QDays v={p.balance} /></button>}</td>}
                      {anyEdit && <td style={{ whiteSpace: 'nowrap' }}>{p.canEdit ? <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Button kind="secondary" size="sm" onClick={() => setDlg({ t: 'pattern', p })}>Change type</Button><Button kind="secondary" size="sm" onClick={() => setDlg({ t: 'mark', p })}>Mark</Button></div> : <span className="sm12 mut">–</span>}</td>}
                    </tr>))}
                </React.Fragment>))}</tbody>
            </table>
          </div>)}
      </>);
    }
  } else if (tab === 'scheduled') {
    body = data.scheduled.length === 0
      ? <div className="card"><EmptyState title="No scheduled changes" body="Roster type changes you set for a future Monday show here until they start." /></div>
      : <DataTable<Scheduled & Record<string, unknown>> columns={[
          { key: 'p', label: 'Person', render: s => <b style={{ fontWeight: 600 }}>{s.name}</b> },
          { key: 'c', label: 'Change', render: s => <span className="sm12">{tname(s.from_pattern)} → <b>{tname(s.to_pattern)}</b> · {pat(s.to_pattern)?.label}<div className="mut">{s.reason}</div></span> },
          { key: 's', label: 'Starts', w: 180, render: s => fd(s.starts_on) },
          { key: 'b', label: 'Set by', w: 240, render: s => <span className="sm12">{s.set_by ?? '–'}<div className="mut">{new Date(s.set_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div></span> },
          ...(anyEdit ? [{ key: 'a', label: '', w: 190, render: (s: Scheduled) => s.canEdit ? <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Button kind="secondary" size="sm" onClick={() => { const p = data.people.find(x => x.userId === s.user_id); if (p) setDlg({ t: 'pattern', p, edit: s }); }}>Edit</Button><Button kind="secondary" size="sm" onClick={() => setDlg({ t: 'cancel', s })}>Cancel</Button></div> : null }] : []),
        ]} rows={data.scheduled as (Scheduled & Record<string, unknown>)[]} foot={<><span>Can be edited or cancelled until the start date</span><span>Past days never change</span></>} />;
  } else if (tab === 'teams') {
    const tls = data.people.filter(p => p.role === 'tl');
    const agents = data.people.filter(p => p.role === 'agent');
    body = (
      <div className="card flush"><table className="tbl"><thead><tr><th>Person</th><th style={{ width: 160 }}>Role</th><th style={{ width: 280 }}>Team lead</th></tr></thead>
        <tbody>{agents.map(p => (
          <tr key={p.userId}><td style={{ fontWeight: 600 }}>{p.name}</td><td className="sm12 mut">{roleLabel(p.role)}</td>
            <td><select className="input sm" aria-label={`Team lead for ${p.name}`} value={p.tlUserId ?? ''} onChange={e => { const tl = tls.find(t => t.userId === Number(e.target.value)); if (tl) setDlg({ t: 'tl', p, tl }); }}>
              {p.tlUserId === null && <option value="" disabled>Not set</option>}{tls.map(t => <option key={t.userId} value={t.userId}>{t.name}</option>)}</select></td></tr>))}</tbody></table>
        <div className="tfoot"><span>Each agent reports to one team lead. A team lead can change the roster of their own team only.</span><span>Changes apply from today and are logged</span></div></div>);
  } else {
    body = (
      <div className="card flush"><table className="tbl"><thead><tr><th>Person</th><th style={{ width: 160 }}>Role</th>{CHANNELS.map(c => <th key={c} style={{ width: 110 }}>{c}</th>)}</tr></thead>
        <tbody>{data.people.map(p => (
          <tr key={p.userId}><td style={{ fontWeight: 600 }}>{p.name}</td><td className="sm12 mut">{roleLabel(p.role)}</td>
            {CHANNELS.map(c => <td key={c}><Toggle label={`${c} for ${p.name}`} on={p.channels.includes(c)} disabled={!p.canEdit} onChange={v => setChannel(p, c, v)} /></td>)}</tr>))}</tbody></table>
        <div className="tfoot"><span>Skills are for information only. They aren’t used in any leave decision.</span><span>{anyEdit ? 'Changes save straight away and are logged' : 'View only'}</span></div></div>);
  }

  const tabs = data && !error ? [{ k: 'grid', label: 'Grid' }, { k: 'scheduled', label: 'Scheduled changes', count: data.scheduled.length }, { k: 'skills', label: 'Skills' }, ...(data.viewer.role === 'admin' ? [{ k: 'teams', label: 'Team leads' }] : [])] : [];
  return (
    <div className="page">
      <PageHeader title="Roster" sub={sub} />
      {tabs.length > 0 && <div style={{ marginBottom: 20 }}><Tabs tabs={tabs} value={tab} onChange={k => setTab(k as Tab)} /></div>}
      {body}
      {data && dlg?.t === 'pattern' && <PatternDialog key={dlg.p.userId + (dlg.edit?.id ?? 0)} person={dlg.p} patterns={data.patterns} today={data.today} edit={dlg.edit} onClose={() => setDlg(null)} onDone={done} />}
      {data && dlg?.t === 'mark' && <MarkExtraDialog person={dlg.p} patterns={data.patterns} today={data.today} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.t === 'statement' && <StatementDialog person={dlg.p} onClose={() => setDlg(null)} />}
      {dlg?.t === 'tl' && <TeamLeadDialog person={dlg.p} tl={dlg.tl} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.t === 'cancel' && <CancelDialog s={dlg.s} onClose={() => setDlg(null)} onDone={done} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
