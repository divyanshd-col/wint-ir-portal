'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { api } from './api';
import { Banner, BalanceCard, Button, CopyId, CountdownDeadline, CountdownFiveMin, ErrorState, LoadingState, PageHeader, QDays, StatusBadge, Tabs, fd, q } from '../ui';
import { HRMS_CHANGED } from '../HrmsShell';
import ApplyForm from './ApplyForm';
import ChangeDialog, { type Act, type ReqLike } from './ChangeDialog';
import { dayW, fr, halfLabel } from './format';
import { useMe } from './useMe';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CardHead = ({ t, right }: { t: string; right?: React.ReactNode }) => <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}><span className="ov">{t}</span>{right}</div>;
const ReqLine = ({ id, s, e, sh, eh, days, right }: { id: string; s: string; e: string; sh: string; eh: string; days: number; right: React.ReactNode }) => (
  <Link className="rqline" href={`/leave/requests?req=${id}`}>
    <div className="col" style={{ gap: 2 }}><span className="b14" style={{ fontWeight: 600, color: '#fff' }}>{fr(s, e)}</span><span className="sm12 mut">{halfLabel(s, e, sh, eh)} · {dayW(days)} · {id}</span></div>{right}
  </Link>
);
const WHY: Record<string, string> = { full: 'Day full.', short_notice: 'Short notice.', too_long: 'Too long.' };

type Dlg = { req: ReqLike; act: Act } | null;

/** Home (prototype page-home.jsx): hello, the four balance cards, what is just submitted and what needs you, the apply form, upcoming leave and your roster. */
export default function HomeScreen() {
  const { me, error, reload } = useMe();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [toast, setToast] = useState<string | null>(null);
  const changed = () => { void reload(); window.dispatchEvent(new Event(HRMS_CHANGED)); };
  if (!me) return <div className="page"><PageHeader title="Home" /><div className="card flush">{error ? <ErrorState title="Couldn’t load" body={error} onRetry={reload} /> : <LoadingState />}</div></div>;
  const first = me.person.name.split(' ')[0];
  const neg = me.available < 0;
  const closed = !me.ready ? 'Leave isn’t set up in this database yet.' : !me.rulesReady ? 'Leave rules aren’t set up yet. Ask an admin. You can apply once they are.' : me.roster.type === null ? 'You have no roster type yet. Ask your TL.' : null;
  const pendN = me.inProcess.length + me.upcoming.filter(u => u.status === 'In process' || u.status === 'Pending for approval').length + me.needsAction.length;
  const nc = me.nextCredit;
  const submit = async (v: { start: string; end: string; startHalf: string; endHalf: string; reason: string }) => {
    const r = await api<{ id: string }>('/api/leave/requests', 'POST', v);
    if (!r.ok) return r.error;
    setToast('Submitted. It’s In process for 5 minutes.'); setTimeout(() => setToast(null), 3000); changed(); return null;
  };
  return (
    <div className="page">
      <PageHeader title={`Hi, ${first}`} sub={`${fd(me.today)} · All times in IST`} />
      {(me.needsAction.length > 0 || neg) && (
        <div className="col" style={{ gap: 12, marginBottom: 20 }}>
          {me.needsAction.length > 0 && <Banner kind="error"><b>{me.needsAction.length === 1 ? '1 request needs' : `${me.needsAction.length} requests need`} your action by 11:59 pm IST today.</b> Cancel {me.needsAction.length === 1 ? 'it' : 'them'} or send {me.needsAction.length === 1 ? 'it' : 'them'} to your TL. If you don’t choose, {me.needsAction.length === 1 ? 'it’s' : 'they’re'} cancelled automatically and your days come back.</Banner>}
          {neg && <Banner kind="warn">Your balance is below zero. You can go down to {q(me.negativeLimit)}. Beyond that, any extra days are LOP (unpaid). Your next monthly credit pays this off first.</Banner>}
        </div>)}
      <div className="grid4" style={{ marginBottom: 20 }}>
        <BalanceCard label="Available" neg={neg} note={neg ? <>Can go to <QDays v={me.negativeLimit} size={13} /></> : `Yours to use now. Can go to ${q(me.negativeLimit)}.`}><QDays v={me.available} size={40} /></BalanceCard>
        <BalanceCard label="Pending" note={pendN ? `Held for ${pendN} ${pendN === 1 ? 'request' : 'requests'} waiting for a decision` : 'Nothing held right now'}><QDays v={me.held} size={40} /></BalanceCard>
        <BalanceCard label="LOP this payroll month" note={me.lopMonth.label}>
          <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}><div><QDays v={me.lopMonth.approved} size={32} /><div className="sm12 mut">Approved</div></div><div><QDays v={me.lopMonth.waiting} size={32} /><div className="sm12 mut">Waiting</div></div></div>
        </BalanceCard>
        <BalanceCard label="Next credit" note={nc.amount === null ? 'Starts once the yearly leave count is set.' : neg ? `${fd(nc.date)} at 12:00 am IST. Pays off your ${q(me.available)} first, so you’ll have ${q(me.available + nc.amount)}.` : `${fd(nc.date)} at 12:00 am IST`}>
          {nc.amount === null ? <span className="qd mut" style={{ fontSize: 40, lineHeight: '44px' }}>–</span> : <span className="qd" style={{ fontSize: 40, lineHeight: '44px', color: 'var(--green-400)' }}>+{q(nc.amount)}</span>}
        </BalanceCard>
      </div>
      <div className="hgrid">
        <div className="col" style={{ gap: 20 }}>
          {me.inProcess.map(r => (
            <div key={r.leave_id} className="card col" style={{ gap: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="col" style={{ gap: 4 }}><span className="ov">Just submitted</span><span className="h2s">{fr(r.start_date, r.end_date)}</span><span className="sm12 mut">{halfLabel(r.start_date, r.end_date, r.start_half, r.end_half)} · {dayW(r.days)} · <CopyId id={r.leave_id} /></span></div>
                <StatusBadge status="In process" />
              </div>
              <CountdownFiveMin key={r.window_ends_at} endsAt={r.window_ends_at} />
              <div className="row"><Button kind="secondary" size="sm" onClick={() => setDlg({ req: { ...r, status: 'In process' }, act: 'edit' })}>Edit</Button><Button kind="secondary" size="sm" onClick={() => setDlg({ req: { ...r, status: 'In process' }, act: 'cancel' })}>Cancel</Button><span className="spacer" /><Link className="b14" href={`/leave/requests?req=${r.leave_id}`}>View request ›</Link></div>
            </div>))}
          <div className="card">
            <Tabs tabs={[{ k: 'leave', label: 'Apply for leave' }]} value="leave" onChange={() => {}} />
            <div style={{ marginTop: 20 }}><ApplyForm today={me.today} closed={closed} onSubmit={submit} /></div>
          </div>
        </div>
        <div className="col" style={{ gap: 20 }}>
          <div className="card"><CardHead t="Needs your action" />
            {me.needsAction.length === 0 ? <div className="b14 mut">Nothing needs your action.</div> : me.needsAction.map(n => (
              <div key={n.leave_id} className="col" style={{ gap: 12 }}>
                <ReqLine id={n.leave_id} s={n.start_date} e={n.end_date} sh={n.start_half ?? 'full'} eh={n.end_half ?? 'full'} days={0} right={<StatusBadge status="Auto-rejected" />} />
                <Banner kind="error"><b>{WHY[n.reject_code ?? ''] ?? 'Rejected.'}</b> {n.reject_note}</Banner>
                <CountdownDeadline deadline={n.cancel_deadline} />
                <div className="row"><Button kind="secondary" size="sm" onClick={() => setDlg({ req: { leave_id: n.leave_id, status: 'Auto-rejected', start_date: n.start_date, end_date: n.end_date, start_half: n.start_half ?? 'full', end_half: n.end_half ?? 'full' }, act: 'cancel' })}>Cancel</Button><Button size="sm" onClick={() => setDlg({ req: { leave_id: n.leave_id, status: 'Auto-rejected', start_date: n.start_date, end_date: n.end_date, start_half: n.start_half ?? 'full', end_half: n.end_half ?? 'full' }, act: 'send' })}>Send to TL</Button></div>
              </div>))}
          </div>
          <div className="card"><CardHead t="Upcoming leave" right={<Link href="/leave/requests" className="sm12">All requests ›</Link>} />
            {me.upcoming.length === 0 ? <div className="b14 mut">No approved leave coming up.</div> : me.upcoming.map(u => <ReqLine key={u.leave_id} id={u.leave_id} s={u.start_date} e={u.end_date} sh={u.start_half} eh={u.end_half} days={u.days} right={<StatusBadge status={u.status} />} />)}
          </div>
          <div className="card"><CardHead t="Your roster" />
            {me.roster.type === null ? <div className="b14 mut">No roster type set.</div> : (
              <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                <dt>Type</dt><dd>{me.roster.type} · {me.roster.label}</dd>
                <dt>Week-off</dt><dd>{me.roster.offWeekdays.map(w => DAYS[w]).join(', ')}</dd>
                <dt>Holidays you’re rostered on</dt><dd className="col" style={{ gap: 2 }}>{me.holidays.length === 0 ? <span>None coming up</span> : me.holidays.map(h => <span key={h.day}>{fd(h.day)} · {h.name}</span>)}<span className="sm12 mut">Working one adds 1 day to your balance.</span></dd>
                <dt>Scheduled change</dt><dd>{me.scheduled ? <>Type {me.scheduled.type} · {me.scheduled.label}, from {fd(me.scheduled.starts_on)}{me.scheduled.set_by && <div className="sm12 mut">Set by {me.scheduled.set_by}</div>}</> : 'None'}</dd>
              </dl>)}
          </div>
        </div>
      </div>
      {dlg && <ChangeDialog req={dlg.req} act={dlg.act} onClose={() => setDlg(null)} onDone={m => { setDlg(null); setToast(m); setTimeout(() => setToast(null), 3000); changed(); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
