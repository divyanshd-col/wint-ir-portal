'use client';
import { useState, useEffect } from 'react';
import ChatEvalTable from './ChatEvalTable';
import DisputesTable from './DisputesTable';
import ReviewedChatsTable from './ReviewedChatsTable';

type Tab = 'pending' | 'disputes' | 'reviewed';

export default function ChatEvaluationPage() {
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [pendingCount, setPendingCount]  = useState<number | null>(null);
  const [loadingDisp,  setLoadingDisp]   = useState(true);
  const [tab,          setTab]           = useState<Tab>('pending');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cx/qa/disposition-config');
        if (!res.ok) return;
        const data = await res.json();
        setDispositions(data.dispositions ?? []);
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
    cursor: 'pointer',
  });

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Chat Evaluation
        </h1>
        {pendingCount !== null && (
          <span style={{
            background: 'var(--qa-gray-100)', borderRadius: 6,
            fontSize: 12, color: 'var(--qa-text-2)', padding: '4px 10px',
            fontWeight: 500, whiteSpace: 'nowrap',
          }}>
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
        borderRadius: 10, padding: 4, width: 'fit-content',
      }}>
        <button style={tabStyle(tab === 'pending')}  onClick={() => setTab('pending')}>Pending Review</button>
        <button style={tabStyle(tab === 'disputes')} onClick={() => setTab('disputes')}>Disputes</button>
        <button style={tabStyle(tab === 'reviewed')} onClick={() => setTab('reviewed')}>Reviewed Chats</button>
      </div>

      {/* Tab content */}
      {tab === 'pending' && (
        <ChatEvalTable
          dispositions={loadingDisp ? [] : dispositions}
          onCountChange={setPendingCount}
        />
      )}

      {tab === 'disputes' && (
        <DisputesTable dispositions={loadingDisp ? [] : dispositions} />
      )}

      {tab === 'reviewed' && (
        <ReviewedChatsTable dispositions={loadingDisp ? [] : dispositions} />
      )}

      <p style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic', marginTop: 16 }}>
        Data from live DB · scoped to your assigned dispositions
      </p>
    </div>
  );
}
