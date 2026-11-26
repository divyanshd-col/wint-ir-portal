'use client';

import React, { useEffect, useState } from 'react';
import { fmtQ } from '@/lib/leave';
import { EmptyState } from '@/components/roster/ui';
import { api, card, fmtDay, muted } from './ui';

interface S { name: string; balance: number; held: number; entries: { id: number; at: string; type: string; description: string; leaveId: string | null; amount: number; balance: number }[] }

/** Your own statement, like a bank statement: every change to the balance is one line, nothing is edited. */
export default function StatementView({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<S | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let dead = false; (async () => { const r = await api<S>('/api/leave/statement'); if (dead) return; if (r.ok) { setS(r.data); setError(null); } else setError(r.error); })(); return () => { dead = true; }; }, [refreshKey]);
  if (error) return <div style={card}><EmptyState title="Couldn’t load your statement" body={error} /></div>;
  if (!s) return <div style={{ ...card, ...muted }}>Loading…</div>;
  const when = (iso: string) => { const [d, t] = iso.split('T'); return `${fmtDay(d)} · ${t} IST`; };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div><div style={muted}>Balance</div><div style={{ fontSize: 24, fontWeight: 600, color: s.balance < 0 ? 'var(--fail)' : undefined }}>{fmtQ(s.balance)} <span style={{ ...muted, fontWeight: 400 }}>days</span></div></div>
        <div><div style={muted}>Held for pending requests</div><div style={{ fontSize: 24, fontWeight: 600 }}>{fmtQ(s.held)} <span style={{ ...muted, fontWeight: 400 }}>days</span></div><div style={muted}>Not part of the running balance below</div></div>
      </div>
      <div style={{ ...card, padding: 0, overflow: 'auto' }}>
        {s.entries.length === 0 ? <EmptyState title="No entries yet" body="Every credit, leave and correction shows here as one line." /> : (
          <table className="roster-tbl"><thead><tr><th>Date</th><th>Entry</th><th>Description</th><th>Leave ID</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
            <tbody>{s.entries.map(e => (
              <tr key={e.id}><td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{when(e.at)}</td><td style={{ fontSize: 12 }}>{e.type}</td><td style={{ fontSize: 12 }}>{e.description}</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.leaveId ?? ''}</td>
                <td style={{ textAlign: 'right' }}>{e.amount > 0 ? `+${fmtQ(e.amount)}` : ''}</td><td style={{ textAlign: 'right' }}>{e.amount < 0 ? fmtQ(e.amount) : ''}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: e.balance < 0 ? 'var(--fail)' : undefined }}>{fmtQ(e.balance)}</td></tr>))}</tbody></table>)}
      </div>
      <div style={muted}>Nothing is ever edited or deleted. A mistake is fixed with a new line.</div>
    </div>
  );
}
