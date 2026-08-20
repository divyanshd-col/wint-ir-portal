'use client';
import React, { useState, useEffect, useCallback } from 'react';
import EvalPanel from '@/components/quality/EvalPanel';
import type { TLChatRow } from '@/app/api/cx/tl/chats/route';
import type { TLDisputeRow } from '@/app/api/cx/tl/disputes/route';
import { getDisputeClassification, formatParamLabel } from '@/lib/quality';
import { DisputeThread } from '@/components/quality/DisputeThread';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── Shared table styles ───────────────────────────────────────────────────────
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

const chip: React.CSSProperties = {
  height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
  background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
};
const chipActive: React.CSSProperties = {
  ...chip, background: 'var(--qa-gray-700)', color: '#fff', borderColor: 'var(--qa-gray-700)',
};

// ─── IQS score badge ──────────────────────────────────────────────────────────
function IQSBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13, fontWeight: 500 }}>NIL</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
      fontFamily: 'ui-monospace, monospace',
      background: 'var(--qa-fill-light)', color: 'var(--qa-text-2)',
      border: '1px solid var(--qa-border)',
    }}>{score}</span>
  );
}

// ─── CSAT badge ───────────────────────────────────────────────────────────────
function CSATBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 30, height: 22, borderRadius: 6, fontSize: 12, fontWeight: 600,
      fontFamily: 'ui-monospace, monospace',
      background: 'var(--qa-fill-light)', color: 'var(--qa-text-2)',
      border: '1px solid var(--qa-border)',
    }}>{score === 1 ? 'Bad' : score === 3 ? 'Neutral' : 'Good'}</span>
  );
}

// ─── Dispute Status Pill ───────────────────────────────────────────────────────
export function DisputeStatusPill({
  status,
  raisedByRole,
  reviewNote,
  parameters,
}: {
  status: string;
  raisedByRole?: string;
  reviewNote?: string | null;
  parameters?: any;
}) {
  const role = (raisedByRole || '').toLowerCase();
  const note = (reviewNote || '').toLowerCase();

  let label = '';
  let bg = '#f4f4f5';
  let color = '#52525b';
  let border = '#e4e4e7';

  if (status === 'pending' || status === 'ir_pending_tl') {
    label = 'Dispute raised by IR';
    bg = '#fefce8';
    color = '#854d0e';
    border = '#fef08a';
  } else if (status === 'tl_forwarded') {
    if (role === 'tl') {
      label = 'Dispute raised by TL';
    } else {
      label = 'Forwarded by TL';
    }
    bg = '#eff6ff';
    color = '#1d4ed8';
    border = '#bfdbfe';
  } else if (status === 'tl_resolved') {
    label = 'Resolved by TL';
    bg = '#f3f4f6';
    color = '#374151';
    border = '#e5e7eb';
  } else if (status === 'reviewed') {
    const hasAnswerChanges = Array.isArray(parameters?.__answerChanges) && parameters.__answerChanges.length > 0;
    const isUpdated = hasAnswerChanges || note.includes('score updated') || note.includes('score changed');
    if (isUpdated) {
      label = 'Updated by QA';
      bg = '#f0fdf4';
      color = '#166534';
      border = '#bbf7d0';
    } else {
      label = 'Resolved by QA';
      bg = '#faf5ff';
      color = '#6b21a8';
      border = '#e9d5ff';
    }
  } else if (status === 'cancelled') {
    label = 'Cancelled';
    bg = '#fef2f2';
    color = '#991b1b';
    border = '#fecaca';
  } else {
    label = status;
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color: color,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ─── Chat ID cell ─────────────────────────────────────────────────────────────
function ChatIdCell({ chatId }: { chatId: string }) {
  if (/^\d+$/.test(chatId.trim())) {
    return (
      <a
        href={`https://app.robylon.ai/unified-inbox/share/${chatId}`}
        target="_blank" rel="noopener noreferrer"
        style={{ color: 'var(--qa-text-2)', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
      >{chatId}</a>
    );
  }
  return <>{chatId}</>;
}

// ─── Section A — Evaluated Chats ──────────────────────────────────────────────
function EvaluatedChatsSection({ onTotalChange }: { onTotalChange?: (count: number) => void }) {
  const [chats,      setChats]      = useState<TLChatRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [agents,     setAgents]     = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page,       setPage]       = useState(1);
  const [limit,      setLimit]      = useState(20);
  const [pageSizeDrop, setPageSizeDrop] = useState(false);

  // Filters
  const [agent,   setAgent]   = useState('');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [iqsMin,  setIqsMin]  = useState('');
  const [iqsMax,  setIqsMax]  = useState('');
  const [csat,    setCsat]    = useState<string[]>([]);

  const fetchChats = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pg));
      params.set('limit', String(limit));
      if (agent)  params.set('agent', agent);
      if (from)   params.set('from', from);
      if (to)     params.set('to', to);
      if (iqsMin) params.set('iqs_min', iqsMin);
      if (iqsMax) params.set('iqs_max', iqsMax);
      csat.forEach(v => params.append('csat', v));
      const res = await fetch(`/api/cx/tl/chats?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setChats(data.chats ?? []);
      const totalCount = data.total ?? 0;
      setTotal(totalCount);
      onTotalChange?.(totalCount);
      if (data.agents?.length) setAgents(data.agents);
    } finally {
      setLoading(false);
    }
  }, [agent, from, to, iqsMin, iqsMax, csat, limit, onTotalChange]);

  useEffect(() => { fetchChats(page); }, [fetchChats, page]);

  function applyFilters() { setPage(1); setPageSizeDrop(false); fetchChats(1); }

  const totalPages = Math.ceil(total / limit);

  const inputStyle: React.CSSProperties = {
    height: 28, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6,
    fontSize: 12, fontFamily: 'inherit', background: 'var(--qa-card)', color: 'var(--qa-text)', outline: 'none',
  };

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        padding: '10px 16px', borderBottom: '1px solid var(--qa-border)', background: 'var(--qa-gray-50)',
      }}>
        {agents.length > 0 && (
          <select value={agent} onChange={e => setAgent(e.target.value)} style={{ ...inputStyle, paddingRight: 4 }}>
            <option value="">All Agents</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} placeholder="From" />
        <input type="date" value={to}   onChange={e => setTo(e.target.value)}   style={inputStyle} placeholder="To" />
        <input type="number" value={iqsMin} onChange={e => setIqsMin(e.target.value)} placeholder="IQS min" style={{ ...inputStyle, width: 70 }} />
        <input type="number" value={iqsMax} onChange={e => setIqsMax(e.target.value)} placeholder="IQS max" style={{ ...inputStyle, width: 70 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CSAT</span>
          {['1','3','5'].map(v => (
            <button
              key={v}
              style={csat.includes(v) ? chipActive : chip}
              onClick={() => setCsat(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
            >
              {v === '1' ? 'Bad' : v === '3' ? 'Neutral' : 'Good'}
            </button>
          ))}
        </div>
        <button onClick={applyFilters} style={{ ...chip, background: 'var(--qa-gray-700)', color: '#fff', borderColor: 'var(--qa-gray-700)' }}>
          Apply
        </button>
        <button onClick={() => { setAgent(''); setFrom(''); setTo(''); setIqsMin(''); setIqsMax(''); setCsat([]); setPage(1); fetchChats(1); }}
          style={chip}>Clear</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
            {loading ? 'Loading…' : `Showing ${chats.length} of ${total}`}
          </span>
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              title="Rows per page"
              onClick={() => setPageSizeDrop(p => !p)}
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
            {pageSizeDrop && (
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
                      fontWeight: limit === n ? 600 : 400,
                      background: limit === n ? 'var(--qa-gray-50)' : 'transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light)')}
                    onMouseLeave={e => (e.currentTarget.style.background = limit === n ? 'var(--qa-gray-50)' : 'transparent')}
                    onClick={() => { setLimit(n); setPage(1); setPageSizeDrop(false); }}
                  >
                    {limit === n && <span style={{ fontSize: 10 }}>✓</span>} {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 90 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 65 }} />
          <col style={{ width: 80 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>Chat ID</th>
            <th style={th}>Agent</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS (Agent)</th>
            <th style={{ ...th, textAlign: 'right' }}>Call IQS</th>
            <th style={th}>CSAT</th>
            <th style={{ ...th, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} style={td}>
                    <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : chats.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                No evaluated chats found for your team
              </td>
            </tr>
          ) : (
            chats.map(chat => (
              <React.Fragment key={chat.chatId}>
                <tr
                  style={{ background: expandedId === chat.chatId ? 'var(--qa-gray-50)' : undefined }}
                  onMouseEnter={e => { if (expandedId !== chat.chatId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                  onMouseLeave={e => { if (expandedId !== chat.chatId) e.currentTarget.style.background = ''; }}
                >
                  <td style={tdMono}><ChatIdCell chatId={chat.chatId} /></td>
                  <td style={{ ...td, fontWeight: 500 }}>{chat.agentName}</td>
                  <td style={tdNum}>
                    {chat.iqsScore != null ? <IQSBadge score={chat.iqsScore} /> : <span style={{ color: 'var(--qa-text-3)', fontSize: 13, fontWeight: 500 }}>NIL</span>}
                  </td>
                  <td style={tdNum}>
                    {chat.callIqsScore != null ? (
                      <IQSBadge score={chat.callIqsScore} />
                    ) : chat.callTranscriptStatus === 'transcribed' ? (
                      <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Transcribed</span>
                    ) : chat.callTranscriptStatus === 'pending' ? (
                      <span style={{ fontSize: 12, color: '#ca8a04', fontWeight: 500 }}>Pending</span>
                    ) : (
                      <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>
                    )}
                  </td>
                  <td style={td}><CSATBadge score={chat.csatScore} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      onClick={() => setExpandedId(prev => prev === chat.chatId ? null : chat.chatId)}
                      style={{
                        background: 'none', border: 0, padding: 0,
                        fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                        color: 'var(--qa-text)', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      View{' '}
                      <span style={{
                        fontSize: 11, color: 'var(--qa-text-2)',
                        transform: expandedId === chat.chatId ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.15s', display: 'inline-block',
                      }}>▾</span>
                    </button>
                  </td>
                </tr>
                {expandedId === chat.chatId && (
                  <EvalPanel
                    chatId={chat.chatId}
                    agentName={chat.agentName}
                    iqsScore={chat.iqsScore ?? 0}
                    closedAt={chat.closedAt}
                    disposition={chat.disposition}
                    parameters={chat.parameters}
                    gates={(chat as any).gates}
                    mobileNumber={chat.mobileNumber}
                    mode="view"
                    allowRaiseDispute={true}
                    onDisputeRaised={() => fetchChats(page)}
                    onDone={() => setExpandedId(null)}
                    onClose={() => setExpandedId(null)}
                    colSpan={6}
                    conversationType={chat.conversationType}
                  />
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--qa-border)' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...chip, opacity: page === 1 ? 0.4 : 1 }}>
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...chip, opacity: page === totalPages ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// Helper to derive outcome key for a dispute row
export function getDisputeOutcomeKey(d: TLDisputeRow): string {
  const status = d.status;
  const role = (d.raisedByRole || '').toLowerCase();
  const note = (d.reviewNote || '').toLowerCase();

  if (status === 'pending' || status === 'ir_pending_tl') {
    return 'raised_ir';
  } else if (status === 'tl_forwarded') {
    return role === 'tl' ? 'raised_tl' : 'forwarded';
  } else if (status === 'tl_resolved') {
    return 'resolved_tl';
  } else if (status === 'reviewed') {
    const hasAnswerChanges = Array.isArray(d.parameters?.__answerChanges) && d.parameters.__answerChanges.length > 0;
    const isUpdated = hasAnswerChanges || note.includes('score updated') || note.includes('score changed');
    return isUpdated ? 'updated' : 'resolved_qa';
  } else if (status === 'cancelled') {
    return 'cancelled';
  }
  return status;
}

// ─── Section — Disputes ────────────────────────────────────────────────────────
// 'pending': TL's actionable queue — the only action available is forwarding the
// dispute on to QA (TL has no scoring power, so there's no self-resolve option).
// 'resolved': read-only history of disputes already forwarded or given a final
// decision by QA.
function DisputesSection({ status, onTotalChange }: { status: 'pending' | 'resolved'; onTotalChange?: (count: number) => void }) {
  const [disputes,   setDisputes]   = useState<TLDisputeRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actioning,  setActioning]  = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page,       setPage]       = useState(1);
  const [limit,      setLimit]      = useState(20);
  const [pageSizeDrop, setPageSizeDrop] = useState(false);

  // Filters
  const [agentFilter,   setAgentFilter]   = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [fromFilter,    setFromFilter]    = useState('');
  const [toFilter,      setToFilter]      = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cx/tl/disputes?status=${status}&type=chats`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          const list = data.disputes ?? [];
          setDisputes(list);
          onTotalChange?.(list.length);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, onTotalChange]);

  useEffect(() => { setPage(1); }, [status, disputes.length]);

  const agents = Array.from(new Set(disputes.map(d => d.agentName).filter(Boolean))).sort();

  const filteredDisputes = disputes.filter(d => {
    if (agentFilter && d.agentName !== agentFilter) return false;
    if (outcomeFilter && getDisputeOutcomeKey(d) !== outcomeFilter) return false;
    if (fromFilter) {
      const dDate = d.raisedAt ? d.raisedAt.substring(0, 10) : '';
      if (dDate < fromFilter) return false;
    }
    if (toFilter) {
      const dDate = d.raisedAt ? d.raisedAt.substring(0, 10) : '';
      if (dDate > toFilter) return false;
    }
    return true;
  });

  const colCount = 9;
  const totalPages = Math.max(1, Math.ceil(filteredDisputes.length / limit));
  const pagedDisputes = filteredDisputes.slice((page - 1) * limit, page * limit);

  const inputStyle: React.CSSProperties = {
    height: 28, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6,
    fontSize: 12, fontFamily: 'inherit', background: 'var(--qa-card)', color: 'var(--qa-text)', outline: 'none',
  };

  async function forwardToQA(flagId: string) {
    setActioning(flagId);
    setActionError(null);
    try {
      const res = await fetch('/api/cx/tl/disputes/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId }),
      });
      if (res.ok) {
        setDisputes(prev => {
          const next = prev.filter(d => d.flagId !== flagId);
          onTotalChange?.(next.length);
          return next;
        });
      } else {
        setActionError('Could not forward that dispute — please retry.');
      }
    } catch {
      setActionError('Could not forward that dispute — please retry.');
    } finally {
      setActioning(null);
    }
  }

  async function resolveAtTLLevel(flagId: string) {
    const note = prompt('Enter a note explaining why this query was resolved at TL level:');
    if (note === null) return;
    setActioning(flagId);
    setActionError(null);
    try {
      const res = await fetch('/api/cx/tl/disputes/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, reviewNote: note || 'Resolved query at TL level' }),
      });
      if (res.ok) {
        setDisputes(prev => {
          const next = prev.filter(d => d.flagId !== flagId);
          onTotalChange?.(next.length);
          return next;
        });
      } else {
        setActionError('Could not resolve that dispute — please retry.');
      }
    } catch {
      setActionError('Could not resolve that dispute — please retry.');
    } finally {
      setActioning(null);
    }
  }

  return (
    <>
    {actionError && (
      <div style={{
        padding: '10px 16px', fontSize: 13, color: '#b91c1c',
        background: '#fef2f2', borderBottom: '1px solid var(--qa-border)',
      }}>{actionError}</div>
    )}

    {/* Header / Filter & Rows per page bar */}
    <div style={{
      display: 'flex', flexWrap: 'nowrap', gap: 8, alignItems: 'center', overflowX: 'auto',
      padding: '10px 16px', borderBottom: '1px solid var(--qa-border)', background: 'var(--qa-gray-50)',
    }}>
      {agents.length > 0 && (
        <select value={agentFilter} onChange={e => { setAgentFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, paddingRight: 4 }}>
          <option value="">All Agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      <select value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, paddingRight: 4 }}>
        <option value="">{status === 'pending' ? 'All Statuses' : 'All Outcomes'}</option>
        {status === 'resolved' ? (
          <>
            <option value="updated">Updated by QA</option>
            <option value="resolved_qa">Resolved by QA</option>
            <option value="resolved_tl">Resolved by TL</option>
            <option value="forwarded">Forwarded by TL</option>
            <option value="cancelled">Cancelled</option>
          </>
        ) : (
          <>
            <option value="raised_ir">Dispute raised by IR</option>
            <option value="raised_tl">Dispute raised by TL</option>
          </>
        )}
      </select>

      <input type="date" value={fromFilter} onChange={e => { setFromFilter(e.target.value); setPage(1); }} style={inputStyle} placeholder="From" />
      <input type="date" value={toFilter}   onChange={e => { setToFilter(e.target.value); setPage(1); }}   style={inputStyle} placeholder="To" />

      {(agentFilter || outcomeFilter || fromFilter || toFilter) && (
        <button
          onClick={() => {
            setAgentFilter('');
            setOutcomeFilter('');
            setFromFilter('');
            setToFilter('');
            setPage(1);
          }}
          style={chip}
        >
          Clear
        </button>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : `Showing ${filteredDisputes.length === 0 ? 0 : `${(page - 1) * limit + 1}–${Math.min(page * limit, filteredDisputes.length)}`} of ${filteredDisputes.length}`}
        </span>
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            title="Rows per page"
            onClick={() => setPageSizeDrop(p => !p)}
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
          {pageSizeDrop && (
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
                    fontWeight: limit === n ? 600 : 400,
                    background: limit === n ? 'var(--qa-gray-50)' : 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = limit === n ? 'var(--qa-gray-50)' : 'transparent')}
                  onClick={() => { setLimit(n); setPage(1); setPageSizeDrop(false); }}
                >
                  {limit === n && <span style={{ fontSize: 10 }}>✓</span>} {n}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>

    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: 90 }} />
        <col />
        <col style={{ width: 130 }} />
        <col style={{ width: 85 }} />
        <col style={{ width: 75 }} />
        <col style={{ width: 65 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 150 }} />
        <col style={{ width: 260 }} />
      </colgroup>
      <thead>
        <tr>
          <th style={th}>Chat ID</th>
          <th style={th}>Agent</th>
          <th style={th}>Raised By</th>
          <th style={{ ...th, textAlign: 'right' }}>IQS (Agent)</th>
          <th style={{ ...th, textAlign: 'right' }}>Call IQS</th>
          <th style={th}>CSAT</th>
          <th style={th}>Raised</th>
          <th style={th}>{status === 'pending' ? 'Status' : 'Outcome'}</th>
          <th style={{ ...th, textAlign: 'right' }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: colCount }).map((_, j) => (
                <td key={j} style={td}>
                  <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: '60%' }} />
                </td>
              ))}
            </tr>
          ))
        ) : pagedDisputes.length === 0 ? (
          <tr>
            <td colSpan={colCount} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
              {status === 'pending' ? 'No disputes pending' : 'No resolved disputes yet'}
            </td>
          </tr>
        ) : (
          pagedDisputes.map(d => {
            const targetInfo = getDisputeClassification(d.challengedParams, d.conversationType);
            return (
            <React.Fragment key={d.flagId}>
              <tr
                style={{ background: expandedId === d.chatId ? 'var(--qa-gray-50)' : undefined }}
                onMouseEnter={e => { if (expandedId !== d.chatId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                onMouseLeave={e => { if (expandedId !== d.chatId) e.currentTarget.style.background = ''; }}
              >
                <td style={tdMono}><ChatIdCell chatId={d.chatId} /></td>
                <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.agentName}</td>
                <td style={{ ...td, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                    background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                    borderRadius: 4, padding: '1px 5px', marginRight: 6, color: 'var(--qa-text-2)',
                  }}>{d.raisedBy}</span>
                  {d.raisedByName}
                </td>
                <td style={tdNum}>
                  {d.iqsScore != null ? <IQSBadge score={d.iqsScore} /> : <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>}
                </td>
                <td style={tdNum}>
                  {d.callIqsScore != null ? <IQSBadge score={d.callIqsScore} /> : <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>}
                </td>
                <td style={td}><CSATBadge score={d.csatScore} /></td>
                <td style={{ ...td, fontSize: 12, color: 'var(--qa-text-2)' }}>
                  {fmtDate(d.raisedAt)}
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>{fmtTime(d.raisedAt)}</span>
                </td>
                <td style={{ ...td }}>
                  <DisputeStatusPill
                    status={d.status}
                    raisedByRole={d.raisedByRole}
                    reviewNote={d.reviewNote}
                    parameters={d.parameters}
                  />
                  {d.reviewNote && (
                    <div style={{ fontSize: 11, color: 'var(--qa-text-3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }} title={d.reviewNote}>
                      {d.reviewNote}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => setExpandedId(prev => prev === d.chatId ? null : d.chatId)}
                      style={{
                        border: '1px solid var(--qa-border)', padding: '0 10px',
                        height: 28, borderRadius: 8, fontFamily: 'inherit', fontSize: 12,
                        color: 'var(--qa-text-2)', cursor: 'pointer', whiteSpace: 'nowrap',
                        background: expandedId === d.chatId ? 'var(--qa-gray-100)' : 'transparent',
                      }}
                    >
                      View
                    </button>
                    {status === 'pending' && (
                      <>
                        <button
                          onClick={() => resolveAtTLLevel(d.flagId)}
                          disabled={actioning === d.flagId}
                          style={{
                            height: 28, padding: '0 10px', borderRadius: 8,
                            fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                            background: 'var(--qa-card)', color: 'var(--qa-text)',
                            border: '1px solid var(--qa-border)', cursor: actioning === d.flagId ? 'not-allowed' : 'pointer',
                            opacity: actioning === d.flagId ? 0.6 : 1, whiteSpace: 'nowrap',
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => forwardToQA(d.flagId)}
                          disabled={actioning === d.flagId}
                          style={{
                            height: 28, padding: '0 12px', borderRadius: 8,
                            fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                            background: 'var(--qa-gray-700)', color: '#fff',
                            border: 'none', cursor: actioning === d.flagId ? 'not-allowed' : 'pointer',
                            opacity: actioning === d.flagId ? 0.6 : 1, whiteSpace: 'nowrap',
                          }}
                        >
                          {actioning === d.flagId ? '…' : 'Forward to QA'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>

              {/* Dispute detail: agent note + challenged params + eval panel */}
              {expandedId === d.chatId && (
                <>
                  {/* Note + challenged params row */}
                  <tr>
                    <td colSpan={colCount} style={{ padding: '12px 20px', borderBottom: '1px solid var(--qa-border-sub)', background: 'var(--qa-gray-50)' }}>
                      {d.agentNote && (
                        <div style={{ marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)', marginRight: 8 }}>Agent Note</span>
                          <span style={{ fontSize: 13, color: 'var(--qa-text)' }}>{d.agentNote}</span>
                        </div>
                      )}
                      {d.challengedParams.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            background: targetInfo.badgeBg, color: targetInfo.badgeText,
                            border: `1px solid ${targetInfo.badgeBorder}`,
                            borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', marginRight: 4,
                          }}>
                            Target: {targetInfo.label}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)' }}>Disputed Params</span>
                          {d.challengedParams.map(cp => (
                            <span key={cp.param} title={cp.note} style={{
                              fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                              borderRadius: 4, padding: '2px 6px', color: 'var(--qa-text-2)', cursor: cp.note ? 'help' : 'default',
                            }}>{formatParamLabel(cp.param)}</span>
                          ))}
                        </div>
                      )}
                      <DisputeThread
                        flagId={d.flagId}
                        agentNote={d.agentNote}
                        reviewNote={d.reviewNote}
                        agentName={d.agentName}
                        reviewedBy={(d as any).reviewedBy}
                        reviewerRole={d.status === 'tl_resolved' ? 'tl' : ((d as any).reviewedByRole || 'quality')}
                        flaggedAt={(d as any).flaggedAt || d.raisedAt}
                        reviewedAt={(d as any).reviewedAt}
                        compact
                      />
                    </td>
                  </tr>
                  <EvalPanel
                    chatId={d.chatId}
                    agentName={d.agentName}
                    iqsScore={d.iqsScore ?? 0}
                    closedAt={d.closedAt}
                    disposition={d.disposition}
                    parameters={d.parameters}
                    mobileNumber={d.csatScore != null ? String(d.csatScore) : null}
                    mode="view"
                    flagId={d.flagId}
                    dispute={{
                      raisedBy:        d.raisedBy,
                      raisedByName:    d.raisedByName,
                      agentNote:       d.agentNote,
                      challengedParams: d.challengedParams,
                    }}
                    onDone={() => setExpandedId(null)}
                    onClose={() => setExpandedId(null)}
                    colSpan={colCount}
                    conversationType={d.conversationType}
                  />
                </>
              )}
            </React.Fragment>
          );
        })
      )}
      </tbody>
    </table>

    {/* Pagination Footer */}
    {totalPages > 1 && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--qa-border)' }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...chip, opacity: page === 1 ? 0.4 : 1 }}>
          ← Prev
        </button>
        <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>Page {page} of {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...chip, opacity: page === totalPages ? 0.4 : 1 }}>
          Next →
        </button>
      </div>
    )}
    </>
  );
}

type Tab = 'evaluated' | 'disputes' | 'reviewed';

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

// ─── Root page ────────────────────────────────────────────────────────────────
export default function QualityChatsPage() {
  const [tab, setTab] = useState<Tab>('evaluated');
  const [evaluatedCount, setEvaluatedCount] = useState<number | null>(null);
  const [disputeCount,   setDisputeCount]   = useState<number | null>(null);
  const [reviewedCount,  setReviewedCount]  = useState<number | null>(null);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 36, padding: '0 16px', border: 'none', borderRadius: 8,
    background: active ? 'var(--qa-gray-700)' : 'transparent',
    color: active ? '#fff' : 'var(--qa-text-2)',
    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 500 : 400,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Quality Chats
        </h1>
      </div>

      {/* Tab Bar */}
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
          <button style={tabStyle(tab === 'evaluated')} onClick={() => setTab('evaluated')}>
            Evaluated Chats
            {evaluatedCount !== null && <CountBadge count={evaluatedCount} active={tab === 'evaluated'} />}
          </button>
          <button style={tabStyle(tab === 'disputes')} onClick={() => setTab('disputes')}>
            Disputes Raised
            {disputeCount !== null && disputeCount > 0 && <CountBadge count={disputeCount} active={tab === 'disputes'} />}
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => setTab('reviewed')}>
            Reviewed Disputes
            {reviewedCount !== null && <CountBadge count={reviewedCount} active={tab === 'reviewed'} />}
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      <div style={{ display: tab === 'evaluated' ? 'block' : 'none' }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <EvaluatedChatsSection onTotalChange={setEvaluatedCount} />
        </div>
      </div>

      <div style={{ display: tab === 'disputes' ? 'block' : 'none' }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <DisputesSection status="pending" onTotalChange={setDisputeCount} />
        </div>
      </div>

      <div style={{ display: tab === 'reviewed' ? 'block' : 'none' }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <DisputesSection status="resolved" onTotalChange={setReviewedCount} />
        </div>
      </div>
    </div>
  );
}
