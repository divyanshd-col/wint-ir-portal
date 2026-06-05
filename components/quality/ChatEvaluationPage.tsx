'use client';
import { useState, useEffect } from 'react';
import ChatEvalTable from './ChatEvalTable';
import DisputesTable from './DisputesTable';

export default function ChatEvaluationPage() {
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [pendingCount, setPendingCount]  = useState<number | null>(null);
  const [loadingDisp,  setLoadingDisp]   = useState(true);

  // Fetch QA's assigned dispositions
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cx/qa/disposition-config');
        if (!res.ok) return;
        const data = await res.json();
        // disposition-config returns { dispositions: string[] } for non-admin
        setDispositions(data.dispositions ?? []);
      } finally {
        setLoadingDisp(false);
      }
    })();
  }, []);

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Chat Evaluation
        </h1>
        {pendingCount !== null && (
          <span style={{
            background: 'var(--qa-gray-100)', borderRadius: 6,
            fontSize: 12, color: 'var(--qa-text-2)', padding: '4px 10px',
            fontWeight: 500, whiteSpace: 'nowrap',
          }}>
            {pendingCount} chat{pendingCount !== 1 ? 's' : ''} pending
          </span>
        )}
      </div>

      {/* Section A — Chats to Review */}
      <section style={{ marginBottom: 32 }}>
        <ChatEvalTable
          dispositions={loadingDisp ? [] : dispositions}
          onCountChange={setPendingCount}
        />
      </section>

      {/* Section B — Disputes to Resolve */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
            Disputes to Resolve
          </h2>
        </div>
        <DisputesTable dispositions={loadingDisp ? [] : dispositions} />
      </section>

      <p style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic', marginTop: 0 }}>
        Data from live DB · scoped to your assigned dispositions
      </p>
    </div>
  );
}
