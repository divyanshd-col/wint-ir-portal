'use client';

import React, { useEffect, useState } from 'react';
import { extraDayNote } from '@/lib/roster';
import type { Pattern, Person, Scheduled } from '@/components/roster/ui';
import { Avatar, Banner, Button, Ico, Field, WarningDialog, fd, q, cx } from '../ui';

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return null;
    return (await r.json().catch(() => ({})))?.error || 'Something went wrong. Try again.';
  } catch { return 'Couldn’t reach the server. Try again.'; }
}
const nextMonday = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); };
const isMonday = (iso: string) => !!iso && new Date(iso + 'T00:00:00Z').getUTCDay() === 1;
const first = (n: string) => n.split(' ')[0];

interface Preview { changes: { leave_id: string; day: string; action: 'give_back' | 'deduct'; leave: number; lop: number; text: string }[]; net: number; lopDays: number; warnings: { day: string; half: 'first' | 'second'; count: number; limit: number }[]; fingerprint: string; balance: number; balanceAfter: number }
type PreviewState = { s: 'idle' } | { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ok'; p: Preview };

/** Asks the server what a change would do to the person's leave. Re-runs when the inputs change, and on demand after a refused save. */
function usePreview(body: Record<string, unknown> | null) {
  const key = body ? JSON.stringify(body) : '';
  const [st, setSt] = useState<PreviewState>({ s: key ? 'loading' : 'idle' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!key) return;
    let dead = false;
    const t = setTimeout(async () => {
      setSt({ s: 'loading' });
      try {
        const r = await fetch('/api/roster/assignments/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key });
        const j = await r.json().catch(() => ({}));
        if (!dead) setSt(r.ok ? { s: 'ok', p: j } : { s: 'error', msg: j.error || 'Couldn’t check the leave. Try again.' });
      } catch { if (!dead) setSt({ s: 'error', msg: 'Couldn’t reach the server. Try again.' }); }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [key, tick]);
  return { st: key ? st : ({ s: 'idle' } as PreviewState), refresh: () => setTick(x => x + 1) };
}

const PersonHead = ({ p, sub }: { p: Person; sub: string }) => <div className="row" style={{ gap: 10 }}><Avatar name={p.name} /><div><div className="b14" style={{ fontWeight: 600 }}>{p.name}</div><div className="sm12 mut">{sub}</div></div></div>;
const nowText = (p: Person, patterns: Pattern[]) => { const cur = patterns.find(x => x.id === p.pattern); return cur ? `Now: Type ${cur.id} · ${cur.label}` : 'No roster type set yet'; };
const DlgShell = ({ title, width, onClose, children }: { title: string; width?: number; onClose: () => void; children: React.ReactNode }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="scrim" role="dialog" aria-modal="true" aria-label={title}><div className="dlg col" style={{ gap: 16, width: width ?? 520, maxHeight: '92vh', overflow: 'auto' }}><div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span className="h2s">{title}</span><button type="button" className="iconbtn" aria-label="Close" onClick={onClose}><Ico n="x" /></button></div>{children}</div></div>;
};

/** "Leave that will be recalculated": the prototype's .pv panel, on the server's preview. */
function RecalcPanel({ st, title }: { st: PreviewState; title: string }) {
  if (st.s === 'idle') return null;
  if (st.s === 'error') return <Banner kind="error">{st.msg}</Banner>;
  return (
    <div className="pv"><div className="ov" style={{ marginBottom: 4 }}>{title}</div>
      {st.s === 'loading' ? <div className="b14 mut" style={{ padding: '8px 0' }}>Checking the leave…</div> : st.p.changes.length === 0 ? <div className="b14 mut" style={{ padding: '8px 0' }}>No leave is affected.</div> : (
        <>
          {st.p.changes.map(c => (
            <div key={c.leave_id + c.day + c.action} className="pvrow" style={{ gridTemplateColumns: '1fr 80px' }}>
              <div><b>{fd(c.day)}</b> <span className="mono sm12">{c.leave_id}</span><div className="sm12 mut">{c.text}</div></div>
              <div style={{ textAlign: 'right' }}><span className="qd" style={{ color: c.action === 'give_back' ? 'var(--green-400)' : '#fff' }}>{c.leave === 0 ? 'LOP' : `${c.action === 'give_back' ? '+' : '−'}${q(c.leave)}`}</span></div>
            </div>))}
          <div className="pvrow" style={{ gridTemplateColumns: '1fr 80px' }}>
            <div><b>Net change to balance</b> <span className="sm12 mut">({q(st.p.balance)} → {q(st.p.balanceAfter)}){st.p.lopDays > 0 ? `, ${q(st.p.lopDays)} day${st.p.lopDays === 1 ? '' : 's'} become LOP` : ''}</span></div>
            <div style={{ textAlign: 'right' }}><span className={cx('qd', st.p.net < 0 && 'neg')}>{st.p.net > 0 ? '+' : ''}{q(st.p.net)}</span></div>
          </div>
        </>)}
    </div>
  );
}

/** Change type (create, or edit a scheduled change). The rotation continues from the chosen type. */
export function PatternDialog({ person, patterns, today, edit, onClose, onDone }: { person: Person; patterns: Pattern[]; today: string; edit?: Scheduled; onClose: () => void; onDone: (msg: string) => void }) {
  const [to, setTo] = useState<number | null>(edit?.to_pattern ?? null); // nothing preselected: the rotation may already put them on that type
  const [start, setStart] = useState(edit?.starts_on ?? nextMonday(today));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(false);
  const rot = patterns.filter(p => p.rotates !== false);
  const n = rot.length || 4;
  const rotates = (patterns.find(p => p.id === to)?.rotates) !== false;
  const order = to === null ? [] : Array.from({ length: n }, (_, i) => ((to - 1 + i) % n) + 1);
  const mondayErr = start && !isMonday(start) ? 'The rotation moves on Mondays. Pick a Monday.' : null;
  const inputsOk = to !== null && start > today && isMonday(start);
  const { st, refresh } = usePreview(inputsOk ? (edit ? { kind: 'edit', id: edit.id, toPattern: to, start } : { kind: 'create', userId: person.userId, toPattern: to, start }) : null);
  const warnings = st.s === 'ok' ? st.p.warnings : [];
  const save = async () => {
    if (st.s !== 'ok' || to === null) return;
    setBusy(true);
    const e = edit
      ? await send(`/api/roster/assignments/${edit.id}`, 'PATCH', { toPattern: to, start, reason, expectedUpdatedAt: edit.updated_at, expectedFingerprint: st.p.fingerprint })
      : await send('/api/roster/assignments', 'POST', { userId: person.userId, toPattern: to, start, reason, expectedFingerprint: st.p.fingerprint });
    setBusy(false); setWarn(false);
    if (e) { if (/previewed/.test(e)) refresh(); return setErr(e); }
    onDone(`Saved. Type ${to} starts ${fd(start)}. It shows in Scheduled changes until then.`);
  };
  if (warn) return (
    <WarningDialog title="A day will go over the limit" onOk={save} onCancel={() => setWarn(false)} busy={busy}>
      {warnings.map(w => <div key={w.day + w.half}>{fd(w.day)}, {w.half} half, is already full: {w.count} of {w.limit} off. Saving deducts it from {first(person.name)}’s leave and puts the day over the limit.</div>)}
      <div style={{ marginTop: 8 }}>You can still save it.</div>
    </WarningDialog>);
  return (
    <DlgShell title={edit ? 'Edit scheduled change' : 'Change type'} width={600} onClose={onClose}>
      <PersonHead p={person} sub={nowText(person, patterns)} />
      <Field label="Type for the week they start" req><div className="col" style={{ gap: 6 }}>{rot.map(p => (
        <label key={p.id} className={cx('radio', to === p.id && 'on')}><input type="radio" name="pat" checked={to === p.id} onChange={() => { setTo(p.id); setErr(null); }} /><b>Type {p.id}</b><span className="mut">{p.label}{p.id === person.pattern ? ' · current' : ''}</span></label>))}</div></Field>
      <Field label="Starts on (a Monday)" req help={mondayErr ?? 'Tomorrow at the earliest. Past days never change. It can be edited or cancelled until it starts.'}>
        <input type="date" className="input" style={{ width: 220 }} min={nextMonday(today)} value={start} onChange={e => { setStart(e.target.value); setErr(null); }} />
      </Field>
      <Banner kind="info">{to === null ? 'Pick the type they should be on in the week they start.' : rotates ? `From that Monday they follow the rotation: ${order.map(t => `Type ${t}`).join(' → ')} → Type ${order[0]} again, moving on every Monday.` : 'From that Monday they work Monday to Friday every week, with no rotation.'}</Banner>
      <RecalcPanel st={st} title="Leave that will be recalculated" />
      {warnings.length > 0 && <Banner kind="warn">{warnings.map(w => fd(w.day)).join(', ')} {warnings.length > 1 ? 'are' : 'is'} already at the daily limit. You’ll see a warning before saving, and you can still save it.</Banner>}
      <div className="sm12 mut">{first(person.name)} isn’t sent a message. The change shows in their Statement.</div>
      <Field label="Reason" req help={reason.trim() ? null : 'Required. The button stays off until it’s filled.'}><textarea className="input" placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button kind="secondary" onClick={onClose}>Go back</Button><Button disabled={!reason.trim() || !inputsOk || st.s !== 'ok' || busy} onClick={() => (warnings.length ? setWarn(true) : save())}>Save change</Button></div>
    </DlgShell>
  );
}

export function CancelDialog({ s, onClose, onDone }: { s: Scheduled; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { st, refresh } = usePreview({ kind: 'cancel', id: s.id });
  const go = async () => {
    if (st.s !== 'ok') return;
    setBusy(true);
    const e = await send(`/api/roster/assignments/${s.id}`, 'DELETE', { reason, expectedFingerprint: st.p.fingerprint });
    setBusy(false);
    if (e) { if (/previewed/.test(e)) refresh(); return setErr(e); }
    onDone(`Scheduled change cancelled. ${first(s.name)} stays on the rotation as before.`);
  };
  return (
    <DlgShell title="Cancel scheduled change" onClose={onClose}>
      <div className="b14">{s.name}: Type {s.to_pattern} from {fd(s.starts_on)} (would have been Type {s.from_pattern ?? '–'}). The rotation carries on as it was.</div>
      <RecalcPanel st={st} title="Leave that will be put back" />
      <Field label="Reason" req help={reason.trim() ? null : 'Required.'}><textarea className="input" placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button kind="secondary" onClick={onClose}>Go back</Button><Button disabled={!reason.trim() || st.s !== 'ok' || busy} onClick={go}>Cancel change</Button></div>
    </DlgShell>
  );
}

/** Mark a week-off as worked: a full day or a half. Adds to the balance straight away, nothing to approve. */
export function MarkExtraDialog({ person, patterns, today, onClose, onDone }: { person: Person; patterns: Pattern[]; today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [days, setDays] = useState<string[] | null>(null);
  const [day, setDay] = useState('');
  const [half, setHalf] = useState('full');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/roster/extra-marks?userId=${person.userId}`); const j = await r.json().catch(() => ({}));
        if (dead) return;
        if (r.ok) { setDays(j.days ?? []); setDay((j.days ?? [])[0] ?? ''); } else setErr(j.error || 'Couldn’t load the week-offs.');
      } catch { if (!dead) setErr('Couldn’t reach the server. Try again.'); }
    })();
    return () => { dead = true; };
  }, [person.userId]);
  const credit = half === 'full' ? 1 : 0.5;
  const note = day ? extraDayNote(day, today) : null;
  const go = async () => {
    setBusy(true);
    const e = await send('/api/roster/extra-marks', 'POST', { userId: person.userId, day, half, reason });
    setBusy(false);
    if (e) return setErr(e);
    onDone(`Marked. +${q(credit)} added to ${first(person.name)}’s balance.`);
  };
  return (
    <DlgShell title="Mark extra day worked" onClose={onClose}>
      <PersonHead p={person} sub={nowText(person, patterns).replace('Now: ', '')} />
      {days && days.length === 0 ? <Banner kind="info">{first(person.name)} has no week-off to mark. Only today or earlier week-offs, one extra day per date.</Banner> : (
        <>
          <div className="grid2" style={{ gap: 12 }}>
            <Field label="Week-off they worked" req help="Today or an earlier week-off, since 1 Nov 2026."><select className="input" value={day} onChange={e => { setDay(e.target.value); setErr(null); }} disabled={!days}>{(days ?? []).map(x => <option key={x} value={x}>{fd(x)}</option>)}</select></Field>
            <Field label="Full day or which half" req><select className="input" value={half} onChange={e => setHalf(e.target.value)}><option value="full">Full day</option><option value="first">First half</option><option value="second">Second half</option></select></Field>
          </div>
          {note && <Banner kind="info">This day is from an earlier month, so it is added in this month with a note of the original date.</Banner>}
          <div className="pv">
            <div className="pvrow" style={{ gridTemplateColumns: '190px 1fr' }}><div className="mut">Adds to balance</div><div><b className="qd" style={{ color: 'var(--green-400)' }}>+{q(credit)}</b> <span className="sm12 mut">straight away, no approval needed</span></div></div>
            <div className="pvrow" style={{ gridTemplateColumns: '190px 1fr' }}><div className="mut">Roster</div><div className="sm12">The week-off stays a week-off and gets an Extra mark.</div></div>
          </div>
        </>)}
      <Field label="Reason" req help={reason.trim() ? null : 'Required.'}><textarea className="input" placeholder="For example: called in for the weekend backlog" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button kind="secondary" onClick={onClose}>Go back</Button><Button disabled={!reason.trim() || !day || busy} onClick={go}>Mark extra day</Button></div>
    </DlgShell>
  );
}

/** Change the one team lead an agent reports to (admins). */
export function TeamLeadDialog({ person, tl, onClose, onDone }: { person: Person; tl: Person; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const e = await send('/api/roster/reporting-lines', 'POST', { userId: person.userId, tlUserId: tl.userId, reason });
    setBusy(false);
    if (e) return setErr(e);
    onDone(`${first(person.name)} now reports to ${tl.name}.`);
  };
  return (
    <DlgShell title="Change team lead" onClose={onClose}>
      <div className="b14">{person.name}: {person.tlName ? `from ${person.tlName} ` : ''}to <b>{tl.name}</b>, from today. Team leads can change the roster of the people who report to them.</div>
      <Field label="Reason" req help={reason.trim() ? null : 'Required.'}><textarea className="input" placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button kind="secondary" onClick={onClose}>Go back</Button><Button disabled={!reason.trim() || busy} onClick={go}>Change team lead</Button></div>
    </DlgShell>
  );
}

interface StatementData { name: string; balance: number; entries: { id: number; at: string; type: string; description: string; leaveId: string | null; amount: number; balance: number }[] }
/** One person's statement (opened from the Balance column): the prototype's Statement table, in a dialog. */
export function StatementDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/roster/statement?userId=${person.userId}`); const j = await r.json().catch(() => ({}));
        if (dead) return;
        if (r.ok) setData(j); else setError(j.error || 'Couldn’t load the statement.');
      } catch { if (!dead) setError('Couldn’t reach the server. Try again.'); }
    })();
    return () => { dead = true; };
  }, [person.userId]);
  const when = (iso: string) => { const [d, t] = iso.split('T'); return `${fd(d)} · ${t} IST`; };
  return (
    <DlgShell title={`Statement: ${person.name}`} width={900} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : !data ? <div className="b14 mut">Loading…</div> : (
        <>
          <div className="b14">Balance <span className={cx('qd', data.balance < 0 && 'neg')} style={{ fontSize: 18 }}>{q(data.balance)}</span> <span className="mut">days</span></div>
          {data.entries.length === 0 ? <div className="b14 mut">No entries yet.</div> : (
            <div className="card flush" style={{ maxHeight: '55vh', overflow: 'auto' }}>
              <table className="tbl"><thead><tr><th>Date and time</th><th>Entry</th><th>Description</th><th>Leave ID</th><th className="r">Credit</th><th className="r">Debit</th><th className="r">Balance</th></tr></thead>
                <tbody>{data.entries.map(e => (
                  <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }} className="sm12">{when(e.at)}</td><td className="sm12">{e.type}</td><td className="sm12">{e.description}</td><td className="mono sm12">{e.leaveId ?? ''}</td>
                    <td className="r"><span className="qd">{e.amount > 0 ? `+${q(e.amount)}` : ''}</span></td><td className="r"><span className="qd">{e.amount < 0 ? q(e.amount) : ''}</span></td>
                    <td className="r"><span className={cx('qd', e.balance < 0 && 'neg')} style={{ fontWeight: 700 }}>{q(e.balance)}</span></td></tr>))}</tbody></table>
            </div>)}
          <div className="sm12 mut">Every change to the balance is one line. Nothing is edited or deleted, mistakes are fixed with a new line.</div>
        </>)}
    </DlgShell>
  );
}
