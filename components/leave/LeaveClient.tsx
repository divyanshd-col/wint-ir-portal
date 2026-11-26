'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Banner, EmptyState } from '@/components/roster/ui';
import Approvals from './Approvals';
import Home, { type Me } from './Home';
import Requests from './Requests';
import StatementView from './StatementView';
import { api, card } from './ui';

type Tab = 'home' | 'requests' | 'statement' | 'approvals';

/** The Leave area: your balance and apply, your requests, your statement, and (for TLs and admins) approvals. */
export default function LeaveClient({ initialReq }: { initialReq: string | null }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(initialReq ? 'requests' : null);
  const [openId, setOpenId] = useState<string | null>(initialReq);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => { const r = await api<Me>('/api/leave/me'); if (r.ok) { setMe(r.data); setError(null); } else setError(r.error); }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  const refresh = useCallback(() => { setTick(t => t + 1); void load(); }, [load]);

  if (error) return <Shell><div style={card}><EmptyState title="Couldn’t load Leave" body={error} /></div></Shell>;
  if (!me) return <Shell><div style={{ ...card, fontSize: 13, color: 'var(--qa-text-3)' }}>Loading…</div></Shell>;

  const tabs: [Tab, string][] = [];
  if (me.can.use) tabs.push(['home', 'My leave'], ['requests', 'My requests'], ['statement', 'Statement']);
  if (me.can.approve) tabs.push(['approvals', 'Approvals']);
  const current: Tab = tab && tabs.some(t => t[0] === tab) ? tab : (tabs[0]?.[0] ?? 'home');

  return (
    <Shell>
      {tabs.length === 0 && <Banner kind="info">Admins don’t apply for their own leave yet. Approvals will show here once someone applies.</Banner>}
      {!me.ready && <div style={{ marginBottom: 12 }}><Banner kind="error">Leave tables are missing. Run migrations 038 and 039 on this database.</Banner></div>}
      {tabs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {tabs.map(([k, label]) => <button key={k} type="button" aria-pressed={current === k} onClick={() => setTab(k)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--qa-border)', background: current === k ? 'var(--qa-text)' : 'var(--qa-card)', color: current === k ? 'var(--qa-on-text)' : 'var(--qa-text-2)' }}>{label}</button>)}
        </div>)}
      {current === 'home' && me.can.use && <Home me={me} reload={refresh} onApplied={id => { setOpenId(id); setTab('requests'); }} />}
      {current === 'requests' && me.can.use && <Requests today={me.today} openId={openId} onOpen={setOpenId} refreshKey={tick} onChanged={refresh} />}
      {current === 'statement' && me.can.use && <StatementView refreshKey={tick} />}
      {current === 'approvals' && me.can.approve && <Approvals today={me.today} onChanged={refresh} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 24 }}><div style={{ marginBottom: 16 }}><h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--qa-text)', margin: 0 }}>Leave</h1><div style={{ fontSize: 13, color: 'var(--qa-text-3)', marginTop: 2 }}>Your balance, applying for leave, and decisions. All dates and times are IST.</div></div>{children}</div>;
}
