'use client';
import { useState, useEffect } from 'react';
import CallEvalTable from './CallEvalTable';
import ReviewedCallsTable from './ReviewedCallsTable';

type Tab = 'pending' | 'reviewed';

export default function CallEvaluationPage() {
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [loadingDisp, setLoadingDisp] = useState(true);
  const [tab, setTab] = useState<Tab>('pending');
  const [agentFilter, setAgentFilter] = useState<'all' | 'human_only'>('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cx/qa/disposition-config');
        if (!res.ok) return;
        const data = await res.json();
        const assigned: string[] = data.dispositions ?? [];
        setDispositions(assigned.length ? assigned : (data.availableDispositions ?? []));
      } finally {
        setLoadingDisp(false);
      }
    })();
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 36, padding: '0 16px', border: 'none', borderRadius: 8,
    background: active ? 'var(--qa-gray-700)' : 'transparent',
    color: active ? '#fff' : 'var(--qa-text-2)',
    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 500 : 400,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  function CountBadge({ count, active }: { count: number; active: boolean }) {
    return (
      <span style={{
        fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600, lineHeight: '18px',
        background: active ? 'rgba(255,255,255,0.2)' : 'var(--qa-gray-100)',
        color: active ? '#fff' : 'var(--qa-text-2)',
      }}>
        {count}
      </span>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Call Evaluation
        </h1>
      </div>

      {/* Tab bar & Toggle Row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div style={{
          display: 'flex', gap: 4,
          background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
          borderRadius: 10, padding: 4, width: 'fit-content',
        }}>
          <button style={tabStyle(tab === 'pending')} onClick={() => setTab('pending')}>
            Pending Review
            {pendingCount !== null && <CountBadge count={pendingCount} active={tab === 'pending'} />}
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => setTab('reviewed')}>
            Reviewed Calls
          </button>
        </div>

        {/* Agent Filter Dropdown */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value as any)}
            style={{
              height: 36,
              padding: '0 28px 0 12px',
              border: '1px solid var(--qa-border)',
              borderRadius: 8,
              background: 'var(--qa-card)',
              color: 'var(--qa-text)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23a1a1aa\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              backgroundSize: '12px',
              fontWeight: 500,
            }}
          >
            <option value="all" style={{ background: 'var(--qa-card)', color: 'var(--qa-text)' }}>All</option>
            <option value="human_only" style={{ background: 'var(--qa-card)', color: 'var(--qa-text)' }}>Human Only</option>
          </select>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ display: tab === 'pending' ? 'block' : 'none' }}>
        <CallEvalTable
          dispositions={loadingDisp ? [] : dispositions}
          onCountChange={setPendingCount}
          agentFilter={agentFilter}
        />
      </div>

      <div style={{ display: tab === 'reviewed' ? 'block' : 'none' }}>
        <ReviewedCallsTable
          dispositions={loadingDisp ? [] : dispositions}
          agentFilter={agentFilter}
        />
      </div>

      <p style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic', marginTop: 16 }}>
        Data from live DB · scoped to your assigned dispositions
      </p>
    </div>
  );
}
