'use client';

import React from 'react';
import { fmtQ } from '@/lib/leave';
import { Banner, btnSecondary } from '@/components/roster/ui';
import ApplyForm from './ApplyForm';
import { api, card, fmtCountdown, fmtDay, fmtRange, muted, useCountdown, type Half } from './ui';

export interface Me {
  userId: number; ready: boolean; rulesReady: boolean; rulesMissing: string[]; negativeLimit: number; today: string;
  person: { name: string; role: string }; roster: { type: number | null; label: string | null; offWeekdays: number[] };
  balance: number; held: number; available: number;
  upcoming: { leave_id: string; status: string; start_date: string; end_date: string }[];
  needsAction: { leave_id: string; start_date: string; end_date: string; reject_note: string | null; cancel_deadline: string }[];
  can: { use: boolean; approve: boolean };
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return <div style={{ ...card, flex: '1 1 200px' }}><div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>{label}</div><div style={{ fontSize: 28, fontWeight: 600, margin: '4px 0' }}>{children}</div>{note && <div style={muted}>{note}</div>}</div>;
}

function NeedsAction({ n, reload }: { n: Me['needsAction'][number]; reload: () => void }) {
  const left = useCountdown(n.cancel_deadline);
  const [err, setErr] = React.useState<string | null>(null);
  const act = async (action: 'cancel' | 'send_to_tl') => { const r = await api(`/api/leave/requests/${n.leave_id}`, 'POST', { action }); if (r.ok) reload(); else setErr(r.error); };
  return (
    <div style={{ borderTop: '1px dashed var(--qa-border)', padding: '10px 0', fontSize: 13 }}>
      <div><b>{n.leave_id}</b> · {fmtRange(n.start_date, n.end_date, 'full', 'full')}</div>
      <div style={{ color: 'var(--fail)' }}>Rejected: {n.reject_note}</div>
      <div style={muted}>Choose before 11:59 pm IST or it’s cancelled automatically{left !== null ? ` · ${fmtCountdown(left)} left` : ''}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}><button type="button" style={btnSecondary} onClick={() => act('cancel')}>Cancel</button><button type="button" style={btnSecondary} onClick={() => act('send_to_tl')}>Send to TL</button></div>
      {err && <div style={{ marginTop: 6 }}><Banner kind="error">{err}</Banner></div>}
    </div>
  );
}

/** Summary cards and the apply form. */
export default function Home({ me, reload, onApplied }: { me: Me; reload: () => void; onApplied: (id: string) => void }) {
  const closed = !me.ready ? 'Leave isn’t set up in this database yet.' : !me.rulesReady ? 'Leave rules aren’t set up yet. Ask an admin. You can apply once they are.' : me.roster.type === null ? 'You have no roster type yet. Ask your TL.' : null;
  const neg = me.available < 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="Available balance" note={<>can go to {fmtQ(me.negativeLimit)}</>}><span style={{ color: neg ? 'var(--fail)' : undefined }}>{fmtQ(me.available)}</span> <span style={{ ...muted, fontWeight: 400 }}>days</span></Stat>
        <Stat label="Pending" note="Held for requests waiting for a decision">{fmtQ(me.held)} <span style={{ ...muted, fontWeight: 400 }}>days</span></Stat>
        <div style={{ ...card, flex: '2 1 320px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--qa-text-2)', marginBottom: 6 }}>Your roster</div>
          {me.roster.type === null ? <div style={muted}>No roster type set.</div> : <div style={{ fontSize: 13 }}>Type {me.roster.type} · {me.roster.label}<div style={muted}>Week-off this week: {me.roster.offWeekdays.map(w => DAYS[w]).join(', ')}. Everyone moves to the next type every Monday.</div></div>}
        </div>
      </div>

      {me.needsAction.length > 0 && <div style={card}><div style={{ fontWeight: 600, marginBottom: 2 }}>Needs your action</div>{me.needsAction.map(n => <NeedsAction key={n.leave_id} n={n} reload={reload} />)}</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ ...card, flex: '3 1 440px' }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Apply for leave</div>
          {closed && <div style={{ marginBottom: 12 }}><Banner kind="info">{closed}</Banner></div>}
          <ApplyForm today={me.today} disabled={!!closed} submitLabel="Send request"
            onSubmit={async v => { const r = await api<{ id: string }>('/api/leave/requests', 'POST', v); if (!r.ok) return r.error; reload(); onApplied(r.data.id); return null; }} />
        </div>
        <div style={{ ...card, flex: '1 1 260px' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Upcoming leave</div>
          {me.upcoming.length === 0 ? <div style={muted}>Nothing coming up.</div> : me.upcoming.map(u => (
            <div key={u.leave_id} style={{ borderTop: '1px dashed var(--qa-border)', padding: '8px 0', fontSize: 13 }}>
              {fmtRange(u.start_date, u.end_date, 'full' as Half, 'full' as Half)}<div style={muted}>{u.leave_id} · {u.status}</div>
            </div>))}
        </div>
      </div>
    </div>
  );
}
export { fmtDay };
