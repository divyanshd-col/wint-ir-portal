'use client';
import React, { useState, useEffect } from 'react';
import EvalPanel from './EvalPanel';
import type { DisputeRow } from '@/app/api/cx/qa/disputes/route';

interface Props {
  dispositions: string[];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DisputesTable({ dispositions: _dispositions }: Props) {
  const [disputes,   setDisputes]   = useState<DisputeRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/cx/qa/disputes');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setDisputes(data.disputes ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function toggleExpand(chatId: string) {
    setExpandedId(prev => prev === chatId ? null : chatId);
  }

  function removeDispute(chatId: string) {
    setDisputes(prev => prev.filter(d => d.chatId !== chatId));
    setExpandedId(null);
  }

  const th: React.CSSProperties = {
    height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)',
    fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    height: 52, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)',
    fontSize: 14, color: 'var(--qa-text)', verticalAlign: 'middle',
  };
  const tdMono: React.CSSProperties = { ...td, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text-2)' };
  const tdNum: React.CSSProperties  = { ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13 };
  const tdAct: React.CSSProperties  = { ...td, textAlign: 'right' };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Chat ID</th>
            <th style={th}>Agent</th>
            <th style={th}>Disputed By</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS</th>
            <th style={th}>Date</th>
            <th style={{ ...th, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} style={td}>
                    <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : disputes.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                No disputes pending
              </td>
            </tr>
          ) : (
            disputes.map(d => (
              <React.Fragment key={d.chatId}>
                <tr
                  style={{ background: expandedId === d.chatId ? 'var(--qa-gray-50)' : undefined }}
                  onMouseEnter={e => { if (expandedId !== d.chatId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                  onMouseLeave={e => { if (expandedId !== d.chatId) e.currentTarget.style.background = ''; }}
                >
                  <td style={tdMono}>{d.chatId}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{d.agentName}</td>
                  <td style={{ ...td, fontSize: 13 }}>
                    <span style={{
                      display: 'inline-block', fontSize: 10, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                      borderRadius: 4, padding: '1px 5px', marginRight: 6, color: 'var(--qa-text-2)',
                    }}>
                      {d.raisedBy}
                    </span>
                    {d.raisedByName}
                  </td>
                  <td style={tdNum}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
                      fontFamily: 'ui-monospace, monospace',
                      background: d.iqsScore < 60 ? '#fee2e2' : '#fef9c3',
                      color:      d.iqsScore < 60 ? '#b91c1c' : '#713f12',
                    }}>
                      {d.iqsScore}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 13 }}>{fmtDate(d.closedAt)}</td>
                  <td style={tdAct}>
                    <button
                      onClick={() => toggleExpand(d.chatId)}
                      style={{
                        background: 'none', border: 0, padding: 0,
                        fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                        color: 'var(--qa-text)', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      Resolve{' '}
                      <span style={{
                        fontSize: 11, color: 'var(--qa-text-2)',
                        transform: expandedId === d.chatId ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.15s', display: 'inline-block',
                      }}>▾</span>
                    </button>
                  </td>
                </tr>

                {expandedId === d.chatId && (
                  <EvalPanel
                    chatId={d.chatId}
                    agentName={d.agentName}
                    iqsScore={d.iqsScore}
                    closedAt={d.closedAt}
                    disposition={d.disposition}
                    parameters={d.parameters}
                    mode="resolve"
                    flagId={d.flagId}
                    dispute={{
                      raisedBy:        d.raisedBy,
                      raisedByName:    d.raisedByName,
                      agentNote:       d.agentNote,
                      challengedParams: d.challengedParams,
                    }}
                    onDone={() => removeDispute(d.chatId)}
                    onClose={() => setExpandedId(null)}
                    colSpan={6}
                  />
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
