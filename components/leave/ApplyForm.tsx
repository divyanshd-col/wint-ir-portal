'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { fmtQ } from '@/lib/leave';
import { Banner, Field, btnPrimary, inputCls } from '@/components/roster/ui';
import { HALF_LABEL, api, fmtDay, muted, type Half } from './ui';

export interface FormValues { start: string; end: string; startHalf: Half; endHalf: Half; reason: string }
interface Preview {
  days: { day: string; half: Half; weight: number }[]; leave: number; lop: number; stretch: number; run: { from: string; to: string } | null;
  noticeNeeded: number; noticeGiven: number; outcome: 'auto_approve' | 'route' | 'reject'; deciderText: string; why: string;
  balance: number; held: number; available: number; balanceAfter: number; fullHalves: { day: string; half: string; count: number; limit: number }[];
  lopWarning: string | null; rejectCode: string | null; tooLong: boolean; maxLength: number;
}
type PState = { s: 'idle' } | { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ok'; p: Preview };

/** Start and end date, full or half days, a reason, and a live preview of what will happen before anything is sent. */
export default function ApplyForm({ today, initial, excludeLeaveId, submitLabel, disabled, onSubmit }: {
  today: string; initial?: Partial<FormValues>; excludeLeaveId?: string; submitLabel: string; disabled?: boolean;
  onSubmit: (v: { start: string; end: string; startHalf: Half; endHalf: Half; reason: string }) => Promise<string | null>;
}) {
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? initial?.start ?? '');
  const [halfS, setHalfS] = useState<Half>(initial?.startHalf ?? 'full');
  const [halfE, setHalfE] = useState<Half>(initial?.endHalf ?? 'full');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<PState>({ s: 'idle' });

  const single = !!start && start === end;
  // one day: full / first / second. Longer: it can start on the second half and end on the first half.
  const sh: Half = single ? halfS : halfS === 'first' ? 'full' : halfS;
  const eh: Half = single ? sh : halfE === 'second' ? 'full' : halfE;
  const ready = !!start && !!end && end >= start && start >= today;
  const body = useMemo(() => (ready ? { start, end, startHalf: sh, endHalf: eh, excludeLeaveId } : null), [ready, start, end, sh, eh, excludeLeaveId]);
  const key = body ? JSON.stringify(body) : '';

  useEffect(() => {
    if (!key) return;
    let dead = false;
    const t = setTimeout(async () => {
      setPv({ s: 'loading' });
      const r = await api<Preview>('/api/leave/preview', 'POST', JSON.parse(key));
      if (!dead) setPv(r.ok ? { s: 'ok', p: r.data } : { s: 'error', msg: r.error });
    }, 300);
    return () => { dead = true; clearTimeout(t); };
  }, [key]);
  const state: PState = key ? pv : { s: 'idle' };

  const dateErr = start && start < today ? 'You can’t apply for past dates. If you were absent, your TL adds it.' : end && start && end < start ? 'The end date can’t be before the start date.' : null;
  const valid = ready && reason.trim() && state.s === 'ok' && !disabled;
  const submit = async () => {
    setBusy(true); setErr(null);
    const e = await onSubmit({ start, end, startHalf: sh, endHalf: eh, reason });
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start date"><input type="date" className={inputCls} min={today} value={start} onChange={e => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} disabled={disabled} /></Field>
        <Field label="End date"><input type="date" className={inputCls} min={start || today} value={end} onChange={e => setEnd(e.target.value)} disabled={disabled} /></Field>
        <Field label={single ? 'Full day or which half' : 'First day'}>
          <select className={inputCls} value={sh} onChange={e => setHalfS(e.target.value as Half)} disabled={disabled}>
            {(single ? ['full', 'first', 'second'] : ['full', 'second']).map(h => <option key={h} value={h}>{h === 'second' && !single ? 'Starts on the second half' : HALF_LABEL[h as Half]}</option>)}
          </select>
        </Field>
        {!single && <Field label="Last day">
          <select className={inputCls} value={eh} onChange={e => setHalfE(e.target.value as Half)} disabled={disabled}>
            {['full', 'first'].map(h => <option key={h} value={h}>{h === 'first' ? 'Ends on the first half' : HALF_LABEL[h as Half]}</option>)}
          </select>
        </Field>}
      </div>
      {dateErr && <Banner kind="error">{dateErr}</Banner>}

      {state.s !== 'idle' && <PreviewPanel st={state} />}

      <Field label="Reason" help={reason.trim() ? null : 'Required.'}>
        <textarea className={inputCls} placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} disabled={disabled} />
      </Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div><button type="button" style={{ ...btnPrimary, opacity: valid && !busy ? 1 : .5 }} disabled={!valid || busy} onClick={submit}>{submitLabel}</button></div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, padding: '8px 0', borderTop: '1px dashed var(--qa-border)', fontSize: 13 }}><div style={{ color: 'var(--qa-text-3)' }}>{k}</div><div style={{ color: 'var(--qa-text)' }}>{children}</div></div>;
}

function PreviewPanel({ st }: { st: PState }) {
  const box: React.CSSProperties = { border: '1px solid var(--qa-border)', borderRadius: 12, padding: '10px 14px', background: 'var(--qa-gray-50)' };
  const title = <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qa-text-2)', marginBottom: 4 }}>Before you send it</div>;
  if (st.s === 'loading') return <div style={box}>{title}<div style={muted}>Checking…</div></div>;
  if (st.s === 'error') return <Banner kind="error">{st.msg}</Banner>;
  if (st.s !== 'ok') return null;
  const p = st.p, total = p.leave + p.lop;
  const noticeOk = p.noticeGiven >= p.noticeNeeded || p.leave === 0;
  return (
    <>
      <div style={box}>{title}
        <Row k="Days charged">{fmtQ(total)} day{total === 1 ? '' : 's'}{p.lop > 0 ? <> ({fmtQ(p.leave)} from your balance, <b>{fmtQ(p.lop)} LOP</b>)</> : ''} <span style={muted}>(week-offs aren’t counted)</span></Row>
        <Row k="Days away in a row">{p.stretch}{p.run && p.run.from !== p.run.to ? <span style={muted}> · {fmtDay(p.run.from)} to {fmtDay(p.run.to)}</span> : null}</Row>
        <Row k="Notice">Needs {p.noticeNeeded} day{p.noticeNeeded === 1 ? '' : 's'}, you’re giving {p.noticeGiven}. <b style={{ color: noticeOk ? 'var(--pass)' : 'var(--fail)' }}>{p.leave === 0 ? 'No notice check for LOP' : noticeOk ? 'Enough notice' : 'Not enough notice'}</b></Row>
        <Row k="Who will decide">{p.deciderText}</Row>
        <Row k="Balance after">Available {fmtQ(p.available)} → <b style={{ color: p.balanceAfter < 0 ? 'var(--fail)' : undefined }}>{fmtQ(p.balanceAfter)}</b>{p.held > 0 ? <span style={muted}> · {fmtQ(p.held)} already held for other requests</span> : null}</Row>
      </div>
      {p.lopWarning && <Banner kind="error">{p.lopWarning}. LOP always needs approval.</Banner>}
      {p.outcome === 'reject' && <Banner kind="error">This will be rejected automatically: {p.why}. You’ll then be able to cancel it or send it to your TL.</Banner>}
      {p.outcome !== 'reject' && <Banner kind="info">{p.outcome === 'auto_approve' ? 'The system will approve this after 5 minutes.' : `It will go to a person for a decision after 5 minutes. ${p.why}.`} You can edit or cancel it during those 5 minutes.</Banner>}
    </>
  );
}
