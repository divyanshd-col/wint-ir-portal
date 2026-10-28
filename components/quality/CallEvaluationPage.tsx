'use client';
import AgentFilterSelect from './AgentFilterSelect';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CallEvalTable from './CallEvalTable';
import ReviewedCallsTable from './ReviewedCallsTable';
import DisputesTable from './DisputesTable';

type Tab = 'pending' | 'disputes' | 'reviewed';

function CallEvaluationContent() {
  const searchParams = useSearchParams();
  const targetCallId = searchParams.get('callId') || searchParams.get('call_id') || '';
  const targetMobile = searchParams.get('mobile') || searchParams.get('phone') || searchParams.get('mobile_number') || '';

  const [dispositions, setDispositions] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [disputeCount, setDisputeCount] = useState<number | null>(null);
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
    height: 40, padding: '0 14px', border: 'none', borderRadius: 0, marginBottom: -1,
    background: 'transparent',
    color: active ? 'var(--qa-text)' : 'var(--qa-text-2)',
    borderBottom: `2px solid ${active ? 'var(--qa-text)' : 'transparent'}`, whiteSpace: 'nowrap', flexShrink: 0,
    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  function CountBadge({ count, active }: { count: number; active: boolean }) {
    return (
      <span style={{
        fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600, lineHeight: '18px',
        background: active ? 'var(--ink)' : 'var(--qa-fill-light)',
        color: active ? 'var(--ink-fg)' : 'var(--qa-text-2)',
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
          borderBottom: '1px solid var(--qa-border)', flex: 1, minWidth: 0, overflowX: 'auto',
        }}>
          <button style={tabStyle(tab === 'pending')} onClick={() => setTab('pending')}>
            Pending Review
            {pendingCount !== null && <CountBadge count={pendingCount} active={tab === 'pending'} />}
          </button>
          <button style={tabStyle(tab === 'disputes')} onClick={() => setTab('disputes')}>
            Disputes
            {disputeCount !== null && disputeCount > 0 && <CountBadge count={disputeCount} active={tab === 'disputes'} />}
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => setTab('reviewed')}>
            Reviewed Calls
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ display: tab === 'pending' ? 'block' : 'none' }}>
        <CallEvalTable
          dispositions={loadingDisp ? [] : dispositions}
          onCountChange={setPendingCount}
          agentFilter={agentFilter}
          leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }]} />}
          initialCallId={targetCallId}
          initialMobile={targetMobile}
          onCallNotFound={() => setTab('reviewed')}
        />
      </div>

      <div style={{ display: tab === 'disputes' ? 'block' : 'none' }}>
        <DisputesTable
          type="calls"
          onCountChange={setDisputeCount}
          agentFilter={agentFilter}
          leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }]} />}
          initialMobile={targetMobile}
        />
      </div>

      <div style={{ display: tab === 'reviewed' ? 'block' : 'none' }}>
        <ReviewedCallsTable
          dispositions={loadingDisp ? [] : dispositions}
          agentFilter={agentFilter}
          leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }]} />}
          initialCallId={targetCallId}
          initialMobile={targetMobile}
        />
      </div>
    </div>
  );
}

export default function CallEvaluationPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading call evaluation…</div>}>
      <CallEvaluationContent />
    </Suspense>
  );
}
