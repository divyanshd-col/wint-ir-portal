'use client';

import React, { useEffect, useState } from 'react';
import { fmtQ } from '@/lib/leave';
import { extraDayNote, ROSTER_START } from '@/lib/roster';
import { Avatar, Banner, Field, Modal, btnPrimary, btnSecondary, fmtDay, inputCls, type Pattern, type Person, type Scheduled } from './ui';


async function send(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return null;
    return (await r.json().catch(() => ({})))?.error || 'Something went wrong. Try again.';
  } catch { return 'Couldn’t reach the server. Try again.'; }
}

function PersonHead({ p, patterns }: { p: Person; patterns: Pattern[] }) {
  const cur = patterns.find(x => x.id === p.pattern);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <Avatar name={p.name} />
      <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>{p.name}</div>
        <div style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{cur ? `Now: Type ${cur.id} · ${cur.label}` : 'No roster type set yet'}</div></div>
    </div>
  );
}
const Actions = ({ onClose, children }: { onClose: () => void; children: React.ReactNode }) =>
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" style={btnSecondary} onClick={onClose}>Go back</button>{children}</div>;

const nextMonday = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); };
const isMonday = (iso: string) => !!iso && new Date(iso + 'T00:00:00Z').getUTCDay() === 1;

interface Preview { changes: { leave_id: string; day: string; action: 'give_back' | 'deduct'; leave: number; lop: number; text: string }[]; net: number; lopDays: number; warnings: { day: string; half: 'first' | 'second'; count: number; limit: number }[]; fingerprint: string; balance: number; balanceAfter: number }
type PreviewState = { s: 'idle' } | { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ok'; p: Preview };

/** Asks the server what a change would do to the person's leave. Re-runs when the inputs change, and on demand (after a refused save). */
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

/** The leave a change moves, day by day, with the net effect on the balance and any day already at the daily limit. */
function RecalcPanel({ st, title }: { st: PreviewState; title: string }) {
  const box: React.CSSProperties = { border: '1px solid var(--qa-border)', borderRadius: 12, padding: '12px 14px', background: 'var(--qa-gray-50)' };
  const head = <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qa-text-2)', marginBottom: 6 }}>{title}</div>;
  if (st.s === 'idle') return null;
  if (st.s === 'loading') return <div style={box}>{head}<div style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>Checking the leave…</div></div>;
  if (st.s === 'error') return <Banner kind="error">{st.msg}</Banner>;
  const p = st.p;
  return (
    <>
      <div style={box}>{head}
        {p.changes.length === 0 ? <div style={{ fontSize: 14, color: 'var(--qa-text-2)' }}>No leave is affected.</div> : (
          <>
            {p.changes.map(c => (
              <div key={c.leave_id + c.day + c.action} style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 12, padding: '8px 0', borderTop: '1px dashed var(--qa-border)', fontSize: 13 }}>
                <div><b>{fmtDay(c.day)}</b> <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.leave_id}</span><div style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{c.text}</div></div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: c.action === 'give_back' ? 'var(--pass)' : 'var(--qa-text)' }}>{c.leave === 0 ? 'LOP' : `${c.action === 'give_back' ? '+' : '−'}${fmtQ(c.leave)}`}</div>
              </div>))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 12, padding: '8px 0 0', borderTop: '1px solid var(--qa-border)', fontSize: 13, fontWeight: 600 }}>
              <div>Net change to balance <span style={{ fontWeight: 400, color: 'var(--qa-text-3)' }}>({fmtQ(p.balance)} → {fmtQ(p.balanceAfter)}){p.lopDays > 0 ? `, ${fmtQ(p.lopDays)} day${p.lopDays === 1 ? '' : 's'} become LOP` : ''}</span></div>
              <div style={{ textAlign: 'right' }}>{p.net > 0 ? '+' : ''}{fmtQ(p.net)}</div>
            </div>
          </>)}
      </div>
      {p.warnings.length > 0 && <Banner kind="error">{p.warnings.map(w => `${fmtDay(w.day)} ${w.half} half is already full: ${w.count} of ${w.limit} off`).join('. ')}. Saving puts {p.warnings.length === 1 ? 'that day' : 'those days'} over the daily limit. You can still save it.</Banner>}
    </>
  );
}

/** Create (edit=undefined) or edit a scheduled roster type change. The rotation continues from the chosen type. */
export function PatternDialog({ person, patterns, today, edit, onClose, onDone }: { person: Person; patterns: Pattern[]; today: string; edit?: Scheduled; onClose: () => void; onDone: (msg: string) => void }) {
  const [to, setTo] = useState(edit?.to_pattern ?? patterns[0]?.id ?? 1);
  const [start, setStart] = useState(edit?.starts_on ?? nextMonday(today));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = patterns.filter(p => p.rotates !== false).length || 4;
  const rotates = (patterns.find(p => p.id === to)?.rotates) !== false;
  const order = Array.from({ length: n }, (_, i) => ((to - 1 + i) % n) + 1);
  const mondayErr = start && !isMonday(start) ? 'The rotation moves on Mondays. Pick a Monday.' : null;
  const inputsOk = start > today && isMonday(start);
  const { st, refresh } = usePreview(inputsOk ? (edit ? { kind: 'edit', id: edit.id, toPattern: to, start } : { kind: 'create', userId: person.userId, toPattern: to, start }) : null);
  const valid = reason.trim() && inputsOk && st.s === 'ok';
  const save = async () => {
    if (st.s !== 'ok') return;
    setBusy(true);
    const e = edit
      ? await send(`/api/roster/assignments/${edit.id}`, 'PATCH', { toPattern: to, start, reason, expectedUpdatedAt: edit.updated_at, expectedFingerprint: st.p.fingerprint })
      : await send('/api/roster/assignments', 'POST', { userId: person.userId, toPattern: to, start, reason, expectedFingerprint: st.p.fingerprint });
    setBusy(false);
    if (e) { if (/previewed/.test(e)) refresh(); return setErr(e); }
    onDone(`Saved. Type ${to} starts ${fmtDay(start)}. It shows in Scheduled changes until then.`);
  };
  return (
    <Modal title={edit ? 'Edit scheduled change' : 'Change roster type'} width={600} onClose={onClose}>
      <PersonHead p={person} patterns={patterns} />
      <Field label="Type for the week they start">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {patterns.filter(p => p.rotates !== false).map(p => (
            <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${to === p.id ? 'var(--accent)' : 'var(--qa-border)'}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--qa-text)', cursor: 'pointer' }}>
              <input type="radio" name="pat" checked={to === p.id} onChange={() => { setTo(p.id); setErr(null); }} />
              <b>{p.rotates === false ? 'Fixed' : `Type ${p.id}`}</b><span style={{ color: 'var(--qa-text-3)' }}>{p.label}{p.id === person.pattern ? ' · current' : ''}</span>
            </label>))}
        </div>
      </Field>
      <Field label="Starts on (a Monday)" help={mondayErr ?? 'Tomorrow at the earliest. Past days never change. It can be edited or cancelled until it starts.'}>
        <input type="date" className={inputCls} style={{ width: 220 }} min={nextMonday(today)} value={start} onChange={e => { setStart(e.target.value); setErr(null); }} />
      </Field>
      <Banner kind="info">{rotates ? <>From that Monday they follow the rotation: {order.map(t => `Type ${t}`).join(' → ')} → Type {order[0]} again, moving on every Monday.</> : <>From that Monday they work Monday to Friday every week, with no rotation.</>} {person.name.split(' ')[0]} isn’t sent a message. The change shows in the roster and their Statement.</Banner>
      <RecalcPanel st={st} title="Leave that will be recalculated" />
      <Field label="Reason" help={reason.trim() ? null : 'Required. The button stays off until it’s filled.'}>
        <textarea className={inputCls} placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} />
      </Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: valid && !busy ? 1 : .5 }} disabled={!valid || busy} onClick={save}>{st.s === 'ok' && st.p.warnings.length ? 'Save anyway' : 'Save change'}</button></Actions>
    </Modal>
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
    onDone(`Scheduled change cancelled. ${s.name.split(' ')[0]} stays on the rotation as before.`);
  };
  return (
    <Modal title="Cancel scheduled change" width={560} onClose={onClose}>
      <div style={{ fontSize: 14, color: 'var(--qa-text)' }}>{s.name}: Type {s.to_pattern} from {fmtDay(s.starts_on)} (would have been Type {s.from_pattern ?? '–'}). The rotation carries on as it was.</div>
      <RecalcPanel st={st} title="Leave that will be put back" />
      <Field label="Reason" help={reason.trim() ? null : 'Required.'}><textarea className={inputCls} placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: reason.trim() && st.s === 'ok' && !busy ? 1 : .5 }} disabled={!reason.trim() || st.s !== 'ok' || busy} onClick={go}>Cancel change</button></Actions>
    </Modal>
  );
}

interface StatementData { name: string; balance: number; entries: { id: number; at: string; type: string; description: string; leaveId: string | null; amount: number; balance: number }[] }

/** One person's balance statement, like a bank statement: every line is a change, nothing is edited. */
export function StatementDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/roster/statement?userId=${person.userId}`);
        const j = await r.json().catch(() => ({}));
        if (dead) return;
        if (r.ok) setData(j); else setError(j.error || 'Couldn’t load the statement.');
      } catch { if (!dead) setError('Couldn’t reach the server. Try again.'); }
    })();
    return () => { dead = true; };
  }, [person.userId]);
  const when = (iso: string) => { const [d, t] = iso.split('T'); return `${fmtDay(d)} · ${t} IST`; };
  return (
    <Modal title={`Statement: ${person.name}`} width={860} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : !data ? <div style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>Loading…</div> : (
        <>
          <div style={{ fontSize: 14, color: 'var(--qa-text)' }}>Balance <b style={{ color: data.balance < 0 ? 'var(--fail)' : 'var(--qa-text)' }}>{fmtQ(data.balance)}</b> days</div>
          {data.entries.length === 0 ? <div style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>No entries yet.</div> : (
            <div style={{ overflow: 'auto', maxHeight: '55vh', border: '1px solid var(--qa-border)', borderRadius: 10 }}>
              <table className="roster-tbl"><thead><tr><th>Date</th><th>Entry</th><th>Description</th><th>Leave ID</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                <tbody>{data.entries.map(e => (
                  <tr key={e.id}><td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{when(e.at)}</td><td style={{ fontSize: 12 }}>{e.type}</td><td style={{ fontSize: 12 }}>{e.description}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.leaveId ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>{e.amount > 0 ? `+${fmtQ(e.amount)}` : ''}</td><td style={{ textAlign: 'right' }}>{e.amount < 0 ? fmtQ(e.amount) : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: e.balance < 0 ? 'var(--fail)' : undefined }}>{fmtQ(e.balance)}</td></tr>))}</tbody></table>
            </div>)}
          <div style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>Every change to the balance is one line. Nothing is edited or deleted, mistakes are fixed with a new line.</div>
        </>)}
    </Modal>
  );
}

/** Mark a week-off as worked. Today or any earlier week-off since the roster started. An earlier month is added in this month with a note. */
export function MarkExtraDialog({ person, patterns, days, today, onClose, onDone }: { person: Person; patterns: Pattern[]; days: string[]; today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const visibleOff = days.filter((d, i) => d <= today && person.cells[i] === 'off');
  const [day, setDay] = useState(visibleOff[visibleOff.length - 1] ?? today);
  const [half, setHalf] = useState('full');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const note = day ? extraDayNote(day, today) : null;
  const go = async () => {
    setBusy(true);
    const e = await send('/api/roster/extra-marks', 'POST', { userId: person.userId, day, half, reason });
    setBusy(false);
    if (e) return setErr(e);
    onDone(`Marked. ${person.name.split(' ')[0]} has an extra day on ${fmtDay(day)}.`);
  };
  return (
    <Modal title="Mark extra day worked" onClose={onClose}>
      <PersonHead p={person} patterns={patterns} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Week-off they worked" help="Today or an earlier week-off, from 1 Nov 2026."><input type="date" className={inputCls} min={ROSTER_START} max={today} value={day} onChange={e => setDay(e.target.value)} /></Field>
        <Field label="Full day or which half"><select className={inputCls} value={half} onChange={e => setHalf(e.target.value)}><option value="full">Full day</option><option value="first">First half</option><option value="second">Second half</option></select></Field>
      </div>
      {note && <Banner kind="info">This day is from an earlier month, so it is added in this month with a note of the original date.</Banner>}
      <Banner kind="info">The week-off stays a week-off and gets an Extra mark. Credit to the balance isn’t applied yet.</Banner>
      <Field label="Reason" help={reason.trim() ? null : 'Required.'}><textarea className={inputCls} placeholder="For example: called in for the weekend backlog" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: reason.trim() && day && !busy ? 1 : .5 }} disabled={!reason.trim() || !day || busy} onClick={go}>Mark extra day</button></Actions>
    </Modal>
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
    onDone(`${person.name.split(' ')[0]} now reports to ${tl.name}.`);
  };
  return (
    <Modal title="Change team lead" onClose={onClose}>
      <div style={{ fontSize: 14, color: 'var(--qa-text)' }}>{person.name}: {person.tlName ? `from ${person.tlName} ` : ''}to <b>{tl.name}</b>, from today. Team leads can change the roster of the people who report to them.</div>
      <Field label="Reason" help={reason.trim() ? null : 'Required.'}><textarea className={inputCls} placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: reason.trim() && !busy ? 1 : .5 }} disabled={!reason.trim() || busy} onClick={go}>Change team lead</button></Actions>
    </Modal>
  );
}
