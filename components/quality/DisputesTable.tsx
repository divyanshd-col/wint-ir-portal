'use client';
import React, { useState, useEffect } from 'react';
import EvalPanel from './EvalPanel';
import { ErrorBoundary } from '../../scratch/ErrorBoundary';
import type { DisputeRow } from '@/app/api/cx/qa/disputes/route';

interface Props {
  dispositions: string[];
  onCountChange?: (count: number) => void;
  agentFilter?: 'bot_only' | 'all' | 'human_only';
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

export default function DisputesTable({ onCountChange, agentFilter = 'human_only' }: Props) {
  const [disputes,    setDisputes]    = useState<DisputeRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [threadId,    setThreadId]    = useState<string | null>(null);   // flagId with open thread
  const [threads,     setThreads]     = useState<Record<string, FlagComment[]>>({});
  const [threadLoad,  setThreadLoad]  = useState<string | null>(null);
  const [newComment,  setNewComment]  = useState('');
  const [posting,     setPosting]     = useState(false);
  const [raiserFilter, setRaiserFilter] = useState<'all' | 'tl_endorsed' | 'TL' | 'IR'>('all');
  const [chatIdSearch, setChatIdSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cx/qa/disputes?agent_filter=${agentFilter}`);
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
  }, [agentFilter, onCountChange]);

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
      const data = await res.json();
      if (data.comment) {
        setThreads(prev => ({ ...prev, [flagId]: [...(prev[flagId] ?? []), data.comment] }));
        setNewComment('');
      }
    } finally {
      setPosting(false);
    }
  }

  const hasFilters = !!(chatIdSearch || raiserFilter !== 'all');

  let visibleDisputes = raiserFilter === 'all' ? disputes
    : raiserFilter === 'tl_endorsed' ? disputes.filter(d => d.tlForwarded)
    : disputes.filter(d => d.raisedBy === raiserFilter);

  if (chatIdSearch) {
    const term = chatIdSearch.toLowerCase().trim();
    visibleDisputes = visibleDisputes.filter(d => d.chatId.toLowerCase().startsWith(term));
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

  const chip: React.CSSProperties = {
    height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
    background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
  };
  const chipActive: React.CSSProperties = {
    ...chip, background: 'var(--qa-gray-700)', color: '#fff', borderColor: 'var(--qa-gray-700)',
  };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>

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
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginLeft: 8 }}>Raised by</span>
        {(['all', 'tl_endorsed', 'TL', 'IR'] as const).map(v => (
          <button key={v} style={raiserFilter === v ? chipActive : chip} onClick={() => setRaiserFilter(v)}>
            {v === 'all' ? 'All' : v === 'tl_endorsed' ? 'TL Endorsed ★' : v}
          </button>
        ))}

        <button
          disabled={!hasFilters}
          onClick={() => { setChatIdSearch(''); setRaiserFilter('all'); }}
          style={{
            ...chip,
            color: hasFilters ? 'var(--qa-text)' : 'var(--qa-text-3)',
            opacity: hasFilters ? 1 : 0.5,
            cursor: hasFilters ? 'pointer' : 'not-allowed',
          }}
        >
          Reset Filters
        </button>
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
          ) : visibleDisputes.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                {disputes.length === 0 ? 'No disputes pending' : 'No disputes match the filter'}
              </td>
            </tr>
          ) : (
            visibleDisputes.map(d => (
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
                    {d.tlForwarded && (
                      <span style={{
                        marginLeft: 8, display: 'inline-block', fontSize: 10, fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                        borderRadius: 4, padding: '1px 5px', color: 'var(--qa-text-2)',
                      }}>TL Endorsed</span>
                    )}
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
                      <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>
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
                    <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)', background: 'var(--qa-gray-50)' }}>
                      <div style={{ padding: '16px 20px' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Dispute Thread
                        </div>
                        {threadLoad === d.flagId ? (
                          <div style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>Loading…</div>
                        ) : (threads[d.flagId] ?? []).length === 0 ? (
                          <div style={{ fontSize: 13, color: 'var(--qa-text-3)', marginBottom: 10 }}>No comments yet</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                            {(threads[d.flagId] ?? []).map(c => (
                              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <div style={{
                                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                  background: 'var(--qa-fill-med)', display: 'flex', alignItems: 'center',
                                  justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--qa-text-2)',
                                }}>
                                  {c.authorName.slice(0, 2).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--qa-text)' }}>{c.authorName}</span>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                                      background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                                      borderRadius: 4, padding: '1px 5px', color: 'var(--qa-text-2)',
                                    }}>{c.role}</span>
                                    <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>{fmtDate(c.createdAt)} {fmtTime(c.createdAt)}</span>
                                  </div>
                                  <div style={{ fontSize: 13, color: 'var(--qa-text)', lineHeight: 1.5 }}>{c.content}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* New comment input */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                          <textarea
                            value={newComment}
                            onChange={e => setNewComment(e.target.value)}
                            placeholder="Add a comment…"
                            rows={2}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment(d.flagId); }}
                            style={{
                              flex: 1, resize: 'vertical',
                              border: '1px solid var(--qa-border)', borderRadius: 6,
                              padding: '6px 8px', fontSize: 13, color: 'var(--qa-text)',
                              lineHeight: 1.5, fontFamily: 'inherit',
                              background: 'var(--qa-card)', outline: 'none',
                            }}
                          />
                          <button
                            onClick={() => postComment(d.flagId)}
                            disabled={posting || !newComment.trim()}
                            style={{
                              height: 36, padding: '0 14px', borderRadius: 6,
                              fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                              cursor: posting || !newComment.trim() ? 'not-allowed' : 'pointer',
                              border: '1px solid var(--qa-gray-700)',
                              background: 'var(--qa-gray-700)', color: '#fff',
                              opacity: posting || !newComment.trim() ? 0.5 : 1, flexShrink: 0,
                            }}
                          >
                            {posting ? '…' : 'Post'}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {expandedId === d.chatId && (
                  <ErrorBoundary><EvalPanel
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
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
