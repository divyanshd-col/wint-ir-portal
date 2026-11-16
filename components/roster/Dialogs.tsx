'use client';

import React, { useState } from 'react';
import { Avatar, Banner, Field, Modal, btnPrimary, btnSecondary, fmtDay, inputCls, offShort, type Pattern, type Person, type Scheduled } from './ui';

const addDay = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

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
  const valid = reason.trim() && start > today && isMonday(start);
  const save = async () => {
    setBusy(true);
    const e = edit
      ? await send(`/api/roster/assignments/${edit.id}`, 'PATCH', { toPattern: to, start, reason, expectedUpdatedAt: edit.updated_at })
      : await send('/api/roster/assignments', 'POST', { userId: person.userId, toPattern: to, start, reason });
    setBusy(false);
    if (e) return setErr(e);
    onDone(`Saved. Type ${to} starts ${fmtDay(start)}. It shows in Scheduled changes until then.`);
  };
  return (
    <Modal title={edit ? 'Edit scheduled change' : 'Change roster type'} width={560} onClose={onClose}>
      <PersonHead p={person} patterns={patterns} />
      <Field label="Type for the week they start">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {patterns.map(p => (
            <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${to === p.id ? 'var(--accent)' : 'var(--qa-border)'}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--qa-text)', cursor: 'pointer' }}>
              <input type="radio" name="pat" checked={to === p.id} onChange={() => setTo(p.id)} />
              <b>{p.rotates === false ? 'Fixed' : `Type ${p.id}`}</b><span style={{ color: 'var(--qa-text-3)' }}>{p.label}{p.id === person.pattern ? ' · current' : ''}</span>
            </label>))}
        </div>
      </Field>
      <Field label="Starts on (a Monday)" help={mondayErr ?? 'Tomorrow at the earliest. Past days never change. It can be edited or cancelled until it starts.'}>
        <input type="date" className={inputCls} style={{ width: 220 }} min={nextMonday(today)} value={start} onChange={e => setStart(e.target.value)} />
      </Field>
      <Banner kind="info">{rotates ? <>From that Monday they follow the rotation: {order.map(t => `Type ${t}`).join(' → ')} → Type {order[0]} again, moving on every Monday.</> : <>From that Monday they work Monday to Friday every week, with no rotation.</>} Leave and balances aren’t recalculated by this change yet. {person.name.split(' ')[0]} isn’t sent a message; it shows in the roster.</Banner>
      <Field label="Reason" help={reason.trim() ? null : 'Required. The button stays off until it’s filled.'}>
        <textarea className={inputCls} placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} />
      </Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: valid && !busy ? 1 : .5 }} disabled={!valid || busy} onClick={save}>Save change</button></Actions>
    </Modal>
  );
}

export function CancelDialog({ s, onClose, onDone }: { s: Scheduled; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const e = await send(`/api/roster/assignments/${s.id}`, 'DELETE', { reason });
    setBusy(false);
    if (e) return setErr(e);
    onDone(`Scheduled change cancelled. ${s.name.split(' ')[0]} stays on Type ${s.from_pattern ?? '–'}.`);
  };
  return (
    <Modal title="Cancel scheduled change" onClose={onClose}>
      <div style={{ fontSize: 14, color: 'var(--qa-text)' }}>{s.name}: Type {s.to_pattern} from {fmtDay(s.starts_on)} (would have been Type {s.from_pattern ?? '–'}). The rotation carries on as it was.</div>
      <Field label="Reason" help={reason.trim() ? null : 'Required.'}><textarea className={inputCls} placeholder="Write your reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: reason.trim() && !busy ? 1 : .5 }} disabled={!reason.trim() || busy} onClick={go}>Cancel change</button></Actions>
    </Modal>
  );
}

/** Week-offs in the current month, up to today, that the person can be marked as having worked. */
export function MarkExtraDialog({ person, patterns, days, today, onClose, onDone }: { person: Person; patterns: Pattern[]; days: string[]; today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const opts = days.filter(d => d <= today && d.slice(0, 7) === today.slice(0, 7)).filter(d => person.cells[days.indexOf(d)] === 'off').reverse();
  const [day, setDay] = useState(opts[0] ?? '');
  const [half, setHalf] = useState('full');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      {opts.length === 0 ? <Banner kind="info">No week-off to mark in the days on screen. Switch to Week view and open the week you need.</Banner> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Week-off they worked" help="Today or past week-offs this month."><select className={inputCls} value={day} onChange={e => setDay(e.target.value)}>{opts.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}</select></Field>
          <Field label="Full day or which half"><select className={inputCls} value={half} onChange={e => setHalf(e.target.value)}><option value="full">Full day</option><option value="first">First half</option><option value="second">Second half</option></select></Field>
        </div>)}
      <Banner kind="info">The week-off stays a week-off and gets an Extra mark. Credit to the balance isn’t applied yet.</Banner>
      <Field label="Reason" help={reason.trim() ? null : 'Required.'}><textarea className={inputCls} placeholder="For example: called in for the weekend backlog" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <Actions onClose={onClose}><button type="button" style={{ ...btnPrimary, opacity: reason.trim() && day && !busy ? 1 : .5 }} disabled={!reason.trim() || !day || busy} onClick={go}>Mark extra day</button></Actions>
    </Modal>
  );
}
