'use client';

import React, { useEffect, useState } from 'react';
import { Banner, Button, Field, Legend, QDays, cx, fd } from '../ui';
import MonthCal, { type CalCell } from './MonthCal';
import { addMonths, dayW, sdt } from './format';
import type { CalendarDay, PreviewData } from './types';

const LEG: [string, string][] = [['k-off', 'Week-off'], ['k-hol', 'Holiday'], ['k-full', 'Full for your role'], ['k-leave', 'Your leave'], ['k-pend', 'Waiting'], ['k-pick', 'Selected']];
const PvRow = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="pvrow"><div className="mut">{k}</div><div>{children}</div></div>;
const TAG_NO = { color: 'var(--red-300)', boxShadow: 'inset 0 0 0 1px var(--red-600)' }, TAG_OK = { color: 'var(--green-400)', boxShadow: 'inset 0 0 0 1px var(--green-700)' };

/** The live preview under the form (the prototype's LeavePreview), on the server's answer. */
function LeavePreview({ p }: { p: PreviewData | null }) {
  if (!p) return <div className="pv empty b14 mut">Pick dates on the calendar to see the preview.</div>;
  const total = p.leave + p.lop, rej = p.outcome === 'reject', short = p.rejectCode === 'short_notice';
  return (
    <div className="pv"><div className="ov" style={{ marginBottom: 4 }}>Preview</div>
      <PvRow k="Days charged"><b>{dayW(total)}</b> <span className="mut">· week-offs not counted, a rostered holiday counts as 1</span></PvRow>
      <PvRow k="Days away in a row"><b>{dayW(p.stretch)}</b><div className="col" style={{ gap: 2, marginTop: 4 }}>{p.runParts.map((x, i) => <span key={i} className="sm12 mut">{x.from === x.to ? sdt(x.from) : `${sdt(x.from)} – ${sdt(x.to)}`} · {x.label}</span>)}</div></PvRow>
      <PvRow k="Notice">{p.leave === 0 ? <span className="mut">Not checked for LOP</span> : <>Needs {dayW(p.noticeNeeded)} · you’re giving {dayW(Math.max(p.noticeGiven, 0))} {short ? <span className="tag" style={TAG_NO}>Too short</span> : <span className="tag" style={TAG_OK}>Enough</span>}</>}</PvRow>
      <PvRow k="Who will decide"><b>{p.deciderText}</b>{p.why && !rej && <div className="sm12 mut">{p.why}</div>}</PvRow>
      <PvRow k="Balance after this leave"><QDays v={p.balanceAfter} size={18} /> <span className="sm12 mut">from <QDays v={p.available} size={12} /> now</span></PvRow>
      {p.lop > 0 && <Banner kind="warn"><b>{p.lopWarning}</b><div>If approved, {dayW(p.lop)} will be LOP and {dayW(p.leave)} will come from your balance.</div></Banner>}
      {rej && <Banner kind="error"><b>This will be rejected.</b>
        {short && <div>Short notice: you need {dayW(p.noticeNeeded)} notice and you’re giving {dayW(Math.max(p.noticeGiven, 0))}.</div>}
        {p.rejectCode === 'too_long' && <div>Too long: you’ll be away {dayW(p.stretch)} in a row. The most is {p.maxLength}.</div>}
        {p.fullHalves.length > 0 && <div>Full for your role: {[...new Set(p.fullHalves.map(h => sdt(h.day)))].join(', ')}.</div>}
        <div>You can still submit it. Once it’s rejected, you can cancel it or send it to your TL by 11:59 pm IST that day.</div></Banner>}
    </div>
  );
}

/** Apply for leave: pick dates on the calendar (week-offs, holidays, your leave and full days marked), see the preview, submit. */
export default function ApplyForm({ today, closed, onSubmit }: { today: string; closed: string | null; onSubmit: (v: { start: string; end: string; startHalf: string; endHalf: string; reason: string }) => Promise<string | null> }) {
  const [s, setS] = useState<string | null>(null);
  const [e, setE] = useState<string | null>(null);
  const [sh, setSh] = useState('full');
  const [eh, setEh] = useState('full');
  const [reason, setReason] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [cals, setCals] = useState<Record<string, Map<string, CalendarDay>>>({});
  const [pv, setPv] = useState<PreviewData | null>(null);
  const [pvErr, setPvErr] = useState<{ msg: string; status: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const single = !!s && (!e || s === e);
  const minM = today.slice(0, 7), maxM = addMonths(minM, 11);

  useEffect(() => {
    if (closed || cals[month]) return;
    let dead = false;
    (async () => {
      try { const r = await fetch(`/api/leave/calendar?month=${month}`); const j = await r.json().catch(() => ({})); if (!dead && r.ok) setCals(c => ({ ...c, [month]: new Map((j.days as CalendarDay[]).map(d => [d.day, d])) })); } catch { /* calendar still works, just unmarked */ }
    })();
    return () => { dead = true; };
  }, [month, closed, cals]);

  const key = s ? JSON.stringify({ s, e: e ?? s, sh, eh: single ? sh : eh }) : '';
  useEffect(() => {
    if (!key || closed) { queueMicrotask(() => { setPv(null); setPvErr(null); }); return; }
    const v = JSON.parse(key) as { s: string; e: string; sh: string; eh: string };
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/leave/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: v.s, end: v.e, startHalf: v.sh, endHalf: v.eh }) });
        const j = await r.json().catch(() => ({}));
        if (dead) return;
        if (r.ok) { setPv(j); setPvErr(null); } else { setPv(null); setPvErr({ msg: j.error || 'Couldn’t check that. Try again.', status: r.status }); }
      } catch { if (!dead) { setPv(null); setPvErr({ msg: 'Couldn’t reach the server. Try again.', status: 0 }); } }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [key, closed]);

  const pick = (d: string) => {
    if (!s || (s && e && s !== e) || d < s) { setS(d); setE(d); setSh('full'); setEh('full'); }
    else { setE(d); if (d !== s && !['full', 'second'].includes(sh)) setSh('full'); }
  };
  const map = cals[month];
  const cell = (day: string): CalCell => {
    const c = map?.get(day);
    const past = day < today;
    const halves = [0, 1].map(i => {
      let st: { k: string; t?: string } = c?.holiday ? { k: 'hol', t: c.holiday.split(' ')[0] } : c?.off ? { k: 'off', t: 'Week-off' } : c?.full[i] ? { k: 'full', t: 'Full' } : { k: 'work', t: '' };
      if (c?.mine?.halves[i]) { const k = c.mine.kind; st = { k: k === 'pend' ? 'pend' : k === 'taken' ? 'taken' : k, t: k === 'pend' ? 'Waiting' : k === 'lop' ? 'LOP' : 'Leave' }; }
      const end = e || s;
      if (s && end && day >= s && day <= end && !c?.off) {
        const w = s === end ? sh === 'full' || (sh === 'first') === (i === 0) : !(day === s && sh === 'second' && i === 0) && !(day === end && eh === 'first' && i === 1);
        if (w) st = { k: 'pick', t: st.k === 'full' ? 'Full' : st.k === 'pend' || st.k === 'leave' || st.k === 'lop' ? 'Clash' : 'Selected' };
      }
      return st;
    });
    return { first: halves[0], second: halves[1], disabled: past || !!closed, sel: !!s && day >= s && day <= (e || s), title: past ? 'Past dates can’t be picked' : undefined };
  };
  const blocked = pvErr?.status === 409 && /already have a request/i.test(pvErr.msg);
  const ok = !!s && !!reason.trim() && !blocked && !!pv && !busy && !closed;
  const submit = async () => {
    if (!s) return;
    setBusy(true); setErr(null);
    const m = await onSubmit({ start: s, end: e || s, startHalf: sh, endHalf: single ? sh : eh, reason });
    setBusy(false);
    if (m) return setErr(m);
    setS(null); setE(null); setSh('full'); setEh('full'); setReason(''); setPv(null);
  };
  const ro = (v: string | null) => <div className="input ro">{v ? fd(v) : <span className="mut">Pick on the calendar</span>}</div>;
  return (
    <div className="col" style={{ gap: 20 }}>
      {closed && <Banner kind="info">{closed}</Banner>}
      <MonthCal month={month} setMonth={setMonth} today={today} cell={cell} onPick={pick} min={minM} max={maxM} />
      <Legend items={LEG} />
      <div className="grid2" style={{ gap: 16 }}>
        <Field label="Start date" req>{ro(s)}</Field><Field label="End date" req>{ro(e)}</Field>
        {single
          ? <Field label="Full or half day" req><select className="input" value={sh} onChange={x => { setSh(x.target.value); setEh(x.target.value); }}><option value="full">Full day</option><option value="first">First half</option><option value="second">Second half</option></select></Field>
          : <><Field label="First day" req><select className="input" value={sh} disabled={!s} onChange={x => setSh(x.target.value)}><option value="full">Full day</option><option value="second">Second half only</option></select></Field>
              <Field label="Last day" req><select className="input" value={eh} disabled={!s} onChange={x => setEh(x.target.value)}><option value="full">Full day</option><option value="first">First half only</option></select></Field></>}
      </div>
      {blocked && <Banner kind="error"><b>You already have a request on these dates.</b> {pvErr!.msg.replace(/^You already have a request on those dates\s*/i, '')} Pick other dates, or change that request from My requests.</Banner>}
      {pvErr && !blocked && <Banner kind="error">{pvErr.msg}</Banner>}
      <Field label="Reason" req help={reason.trim() ? null : 'Required.'}><textarea className="input" placeholder="For example: cousin’s wedding in Jaipur" value={reason} maxLength={500} onChange={x => setReason(x.target.value)} /></Field>
      <LeavePreview p={pv} />
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="sm12 mut">Every request waits 5 minutes before anything happens.</span><Button disabled={!ok} onClick={submit} className={cx(busy && 'busy')}>Submit request</Button></div>
    </div>
  );
}
