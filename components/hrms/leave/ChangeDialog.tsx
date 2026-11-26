'use client';

import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Banner, Button, CopyId, Field, Ico, WarningDialog, fd } from '../ui';
import { fr } from './format';
import type { Half } from './types';

export interface ReqLike { leave_id: string; status: string; start_date: string; end_date: string; start_half: Half; end_half: Half }
export type Act = 'edit' | 'cancel' | 'send';
const ACTS: Record<Act, { t: string; btn: string; note?: string; done: string }> = {
  edit: { t: 'Edit request', btn: 'Save changes', done: 'Saved. The 5 minutes start again.' },
  cancel: { t: 'Cancel request', btn: 'Cancel request', done: 'Cancelled. Your days are back in your balance.' },
  send: { t: 'Send to TL', btn: 'Send to TL', note: 'Your TL can reject it or forward it to an admin. An admin makes the final decision.', done: 'Sent to your TL.' },
};

/** The prototype's change dialog for the actions that exist today: edit a waiting request, cancel it, send an auto-rejected one to the TL. */
export default function ChangeDialog({ req, act, onClose, onDone }: { req: ReqLike; act: Act; onClose: () => void; onDone: (msg: string) => void }) {
  const A = ACTS[act];
  const [ns, setNs] = useState(req.start_date);
  const [ne, setNe] = useState(req.end_date);
  const [reason, setReason] = useState('');
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (warn) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [warn, onClose]);
  const waiting = ['In process', 'Pending for approval', 'Auto-rejected'].includes(req.status);
  const finish = async () => {
    setBusy(true); setErr(null);
    const id = req.leave_id;
    const multi = ns !== ne;
    const r = act === 'edit'
      ? await api(`/api/leave/requests/${id}`, 'PATCH', { start: ns, end: ne, startHalf: multi && req.start_half === 'first' ? 'full' : req.start_half, endHalf: multi && req.end_half === 'second' ? 'full' : multi ? req.end_half : req.start_half, reason })
      : await api(`/api/leave/requests/${id}`, 'POST', { action: act === 'send' ? 'send_to_tl' : 'cancel', reason });
    setBusy(false); setWarn(false);
    if (!r.ok) return setErr(r.error);
    onDone(A.done);
  };
  if (warn) return (
    <WarningDialog title={A.t} onOk={finish} onCancel={() => setWarn(false)} busy={busy}>
      {waiting ? `Your request for ${fr(req.start_date, req.end_date)} will be cancelled and its days go back to your balance.` : `Your leave for ${fr(req.start_date, req.end_date)} will be cancelled straight away and its days go back to your balance. Your TL is told.`}
    </WarningDialog>);
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={A.t}><div className="dlg col" style={{ gap: 16, width: 520 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span className="h2s">{A.t}</span><button type="button" className="iconbtn" aria-label="Close" onClick={onClose}><Ico n="x" /></button></div>
      <div className="row sm12 mut" style={{ gap: 8 }}><CopyId id={req.leave_id} /><span>{fr(req.start_date, req.end_date)}</span></div>
      {act === 'edit' && <div className="grid2" style={{ gap: 12 }}>
        <Field label="New start date" req><input type="date" className="input" value={ns} onChange={x => setNs(x.target.value)} /></Field>
        <Field label="New end date" req><input type="date" className="input" min={ns} value={ne} onChange={x => setNe(x.target.value)} /></Field>
      </div>}
      {A.note && <Banner kind="info">{A.note}</Banner>}
      <Field label="Reason" req help={reason.trim() ? null : 'Required. The button stays off until it’s filled.'}><textarea className="input" placeholder="Write your reason" value={reason} maxLength={500} onChange={x => setReason(x.target.value)} /></Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button kind="secondary" onClick={onClose}>Go back</Button>
        <Button disabled={!reason.trim() || busy || (act === 'edit' && (!ns || !ne || ne < ns || (ns === req.start_date && ne === req.end_date)))} onClick={() => (act === 'cancel' ? setWarn(true) : finish())}>{A.btn}</Button>
      </div>
    </div></div>
  );
}
export { fd };
