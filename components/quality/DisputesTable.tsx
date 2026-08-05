'use client';
import React, { useState, useEffect } from 'react';
import EvalPanel from './EvalPanel';
import { ErrorBoundary } from '../../scratch/ErrorBoundary';
import type { DisputeRow } from '@/app/api/cx/qa/disputes/route';
import { getDisputeClassification } from '@/lib/quality';
import { DisputeThread } from './DisputeThread';

interface Props {
  onCountChange?: (count: number) => void;
  agentFilter?: 'bot_only' | 'all' | 'human_only' | 'has_calls';
  hasCallsFilter?: 'all' | 'has_calls' | 'no_calls';
}

interface FlagComment {
  id: string;
  flagId: string;
  authorEmail: string;
  authorName: string;
  role: string;
  content: string;
  createdAt: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function DisputesTable({ onCountChange, agentFilter = 'human_only', hasCallsFilter = 'all' }: Props) {
  const [disputes,    setDisputes]    = useState<DisputeRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [threadId,    setThreadId]    = useState<string | null>(null);   // flagId with open thread
  const [threads,     setThreads]     = useState<Record<string, FlagComment[]>>({});
  const [threadLoad,  setThreadLoad]  = useState<string | null>(null);
  const [newComment,  setNewComment]  = useState('');
  const [posting,     setPosting]     = useState(false);
  const [chatIdSearch, setChatIdSearch] = useState('');
  const [callsFilter,  setCallsFilter]  = useState<'all' | 'has_calls' | 'no_calls'>(hasCallsFilter);
  const [openDrop,     setOpenDrop]     = useState<string | null>(null);
  const [page,         setPage]         = useState(1);
  const [pageSize,     setPageSize]     = useState(20);

  useEffect(() => {
    setCallsFilter(hasCallsFilter);
  }, [hasCallsFilter]);

  useEffect(() => {
    setPage(1);
  }, [agentFilter, callsFilter, chatIdSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ agent_filter: agentFilter });
        if (callsFilter !== 'all') params.set('has_calls', callsFilter);
        const res = await fetch(`/api/cx/qa/disputes?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setDisputes(data.disputes ?? []);
          onCountChange?.(data.disputes?.length ?? 0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentFilter, callsFilter, onCountChange]);

  function toggleExpand(chatId: string) {
    setExpandedId(prev => prev === chatId ? null : chatId);
    setThreadId(null);
  }

  function removeDispute(chatId: string) {
    setDisputes(prev => prev.filter(d => d.chatId !== chatId));
    setExpandedId(null);
    setThreadId(null);
  }

  async function openThread(flagId: string) {
    if (threadId === flagId) { setThreadId(null); return; }
    setExpandedId(null);
    setThreadId(flagId);
    setNewComment('');
    if (threads[flagId]) return;
    setThreadLoad(flagId);
    try {
      const res = await fetch(`/api/quality/flag-thread?flagId=${encodeURIComponent(flagId)}`);
      const data = await res.json();
      setThreads(prev => ({ ...prev, [flagId]: data.comments ?? [] }));
    } finally {
      setThreadLoad(null);
    }
  }

  async function postComment(flagId: string) {
    if (!newComment.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch('/api/quality/flag-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, content: newComment.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(prev => ({ ...prev, [flagId]: [...(prev[flagId] || []), data.comment] }));
        setNewComment('');
      }
    } finally {
      setPosting(false);
    }
  }

  // The old "Raised by" chips (TL / TL Endorsed) are gone: every dispute that
  // reaches QA has been forwarded by a TL, so the chip marked every row and the
  // filters could never narrow anything down.
  const hasFilters = !!(chatIdSearch || callsFilter !== 'all');

  let visibleDisputes = disputes;

  if (chatIdSearch) {
    const term = chatIdSearch.toLowerCase().trim();
    visibleDisputes = visibleDisputes.filter(d => d.chatId.toLowerCase().startsWith(term));
  }

  const totalPages = Math.max(1, Math.ceil(visibleDisputes.length / pageSize));
  const pagedDisputes = visibleDisputes.slice((page - 1) * pageSize, page * pageSize);

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

  const chip: React.CSSProperties = {
    height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
    background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
  };
  const chipActive: React.CSSProperties = {
    ...chip, background: 'var(--qa-gray-700)', color: '#fff', borderColor: 'var(--qa-gray-700)',
  };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflowX: 'auto', maxWidth: '100%' }}>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--qa-border)', flexWrap: 'wrap' }}>
        <input
          placeholder="Search by Chat ID…"
          value={chatIdSearch}
          onChange={e => setChatIdSearch(e.target.value)}
          style={{
            height: 32, padding: '0 10px', border: `1px solid ${chatIdSearch ? 'var(--qa-gray-700)' : 'var(--qa-border)'}`, borderRadius: 8,
            background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit',
            outline: 'none', width: 140
          }}
        />
        {/* Calls filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={callsFilter !== 'all' ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'calls' ? null : 'calls')}>
            {callsFilter === 'has_calls' ? 'Has Calls' : callsFilter === 'no_calls' ? 'No Calls' : 'Calls'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'calls' && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4,
              background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 140, padding: '6px 0',
            }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '8px 14px', fontSize: 13, color: 'var(--qa-text)', cursor: 'pointer', fontWeight: callsFilter === 'all' ? 600 : 400 }}
                onClick={() => { setCallsFilter('all'); setOpenDrop(null); }}>All</div>
              <div style={{ padding: '8px 14px', fontSize: 13, color: 'var(--qa-text)', cursor: 'pointer', fontWeight: callsFilter === 'has_calls' ? 600 : 400 }}
                onClick={() => { setCallsFilter('has_calls'); setOpenDrop(null); }}>Has Calls</div>
              <div style={{ padding: '8px 14px', fontSize: 13, color: 'var(--qa-text)', cursor: 'pointer', fontWeight: callsFilter === 'no_calls' ? 600 : 400 }}
                onClick={() => { setCallsFilter('no_calls'); setOpenDrop(null); }}>No Calls</div>
            </div>
          )}
        </div>

        <button
          disabled={!hasFilters}
          onClick={() => { setChatIdSearch(''); setCallsFilter('all'); }}
          style={{
            ...chip,
            color: hasFilters ? 'var(--qa-text)' : 'var(--qa-text-3)',
            opacity: hasFilters ? 1 : 0.5,
            cursor: hasFilters ? 'pointer' : 'not-allowed',
          }}
        >
          Reset Filters
        </button>

        {/* Rows per page selector + count */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
            {loading ? 'Loading…' : `Showing ${pagedDisputes.length} of ${visibleDisputes.length}`}
          </span>
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              title="Rows per page"
              onClick={() => setOpenDrop(openDrop === 'pagesize' ? null : 'pagesize')}
              style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
            {openDrop === 'pagesize' && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
                background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)', minWidth: 130, overflow: 'hidden',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                  Rows per page
                </div>
                {[20, 50, 100].map(n => (
                  <div
                    key={n}
                    style={{
                      padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--qa-text)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontWeight: pageSize === n ? 600 : 400,
                      background: pageSize === n ? 'var(--qa-gray-50)' : 'transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light)')}
                    onMouseLeave={e => (e.currentTarget.style.background = pageSize === n ? 'var(--qa-gray-50)' : 'transparent')}
                    onClick={() => { setPageSize(n); setPage(1); setOpenDrop(null); }}
                  >
                    {pageSize === n && <span style={{ fontSize: 10 }}>✓</span>} {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Chat ID</th>
            <th style={th}>Agent</th>
            <th style={th}>Disputed By</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS (Bot)</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS (Agent)</th>
            <th style={th}>Call Transcript</th>
            <th style={th}>CSAT</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} style={td}>
                    <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : pagedDisputes.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                {disputes.length === 0 ? 'No disputes pending' : 'No disputes match the filter'}
              </td>
            </tr>
          ) : (
            pagedDisputes.map(d => {
              const targetInfo = getDisputeClassification(d.challengedParams, d.conversationType);
              return (
              <React.Fragment key={d.chatId}>
                <tr
                  style={{ background: expandedId === d.chatId || threadId === d.flagId ? 'var(--qa-gray-50)' : undefined }}
                  onMouseEnter={e => { if (expandedId !== d.chatId && threadId !== d.flagId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                  onMouseLeave={e => { if (expandedId !== d.chatId && threadId !== d.flagId) e.currentTarget.style.background = ''; }}
                >
                  <td style={tdMono}>
                    {/^\d+$/.test(d.chatId.trim()) ? (
                      <a
                        href={`https://app.robylon.ai/unified-inbox/share/${d.chatId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--qa-text-2)', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                        onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {d.chatId}
                      </a>
                    ) : (
                      d.chatId
                    )}
                  </td>
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
                    {d.botIqsScore !== null ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
                        fontFamily: 'ui-monospace, monospace',
                        background: d.botIqsScore < 60 ? '#fee2e2' : '#fef9c3',
                        color:      d.botIqsScore < 60 ? '#b91c1c' : '#713f12',
                      }}>
                        {d.botIqsScore}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>
                    )}
                  </td>
                  <td style={tdNum}>
                    {d.iqsScore !== null ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
                        fontFamily: 'ui-monospace, monospace',
                        background: d.iqsScore < 60 ? '#fee2e2' : '#fef9c3',
                        color:      d.iqsScore < 60 ? '#b91c1c' : '#713f12',
                      }}>
                        {d.iqsScore}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--qa-text-3)', fontSize: 13, fontWeight: 500 }}>NIL</span>
                    )}
                  </td>
                  <td style={td}>
                    {d.callTranscriptStatus === 'transcribed' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#16a34a', fontWeight: 500 }}>
                        <span style={{ fontSize: 11 }}>✓</span> Transcribed
                      </span>
                    ) : d.callTranscriptStatus === 'pending' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#ca8a04', fontWeight: 500 }}>
                        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#ca8a04' }} className="animate-pulse" />
                        Pending
                      </span>
                    ) : (
                      <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>No Call</span>
                    )}
                  </td>
                  <td style={td}>
                    {d.csatScore == null ? (
                      <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>
                    ) : (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 30, height: 22, borderRadius: 6, fontSize: 12, fontWeight: 600,
                        fontFamily: 'ui-monospace, monospace',
                        background: 'var(--qa-fill-light)', color: 'var(--qa-text-2)',
                        border: '1px solid var(--qa-border)',
                      }}>
                        {d.csatScore === 1 ? 'Bad' : d.csatScore === 3 ? 'Neutral' : 'Good'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdAct, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, border: 'none', height: 52 }}>
                    {/* Thread button */}
                    <button
                      onClick={() => openThread(d.flagId)}
                      style={{
                        border: '1px solid var(--qa-border)', padding: '0 10px',
                        height: 28, borderRadius: 8,
                        fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                        color: threadId === d.flagId ? 'var(--qa-text)' : 'var(--qa-text-2)',
                        cursor: 'pointer', background: threadId === d.flagId ? 'var(--qa-gray-100)' : 'transparent',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      💬 Comment
                    </button>
                    {/* Resolve button */}
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

                {/* Thread panel */}
                {threadId === d.flagId && (
                  <tr>
                    <td colSpan={8} style={{ padding: '0 20px', borderBottom: '1px solid var(--qa-border)', background: 'var(--qa-gray-50)' }}>
                      <DisputeThread
                        flagId={d.flagId}
                        agentNote={d.agentNote}
                        agentName={d.agentName}
                        flaggedAt={(d as any).raisedAt || (d as any).flaggedAt}
                        compact
                      />
                    </td>
                  </tr>
                )}

                {expandedId === d.chatId && (
                  <React.Fragment>
                    <tr>
                      <td colSpan={8} style={{ padding: '12px 20px', borderBottom: '1px solid var(--qa-border-sub)', background: 'var(--qa-gray-50)' }}>
                        <DisputeThread
                          flagId={d.flagId}
                          agentNote={d.agentNote}
                          agentName={d.agentName}
                          flaggedAt={(d as any).raisedAt || (d as any).flaggedAt}
                          compact
                        />
                      </td>
                    </tr>
                    <ErrorBoundary>
                      <EvalPanel
                        chatId={d.chatId}
                        agentName={d.agentName}
                        iqsScore={d.iqsScore ?? 0}
                        closedAt={d.closedAt}
                        disposition={d.disposition}
                        parameters={d.parameters}
                        gates={(d as any).gates}
                        mobileNumber={d.mobileNumber}
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
                        colSpan={8}
                        conversationType={d.conversationType}
                      />
                    </ErrorBoundary>
                  </React.Fragment>
                )}
              </React.Fragment>
            );
          })
        )}
        </tbody>
      </table>

      {/* Pagination Footer */}
      {totalPages > 1 && !loading && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--qa-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>Page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{
              height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6,
              background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit', cursor: page <= 1 ? 'not-allowed' : 'pointer',
              color: page <= 1 ? 'var(--qa-text-3)' : 'var(--qa-text)',
            }}>← Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{
              height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6,
              background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              color: page >= totalPages ? 'var(--qa-text-3)' : 'var(--qa-text)',
            }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
