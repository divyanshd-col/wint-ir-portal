'use client';
import React, { useState, useEffect, useCallback } from 'react';
import EvalPanel from '@/components/quality/EvalPanel';
import type { TLChatRow } from '@/app/api/cx/tl/chats/route';
import type { TLDisputeRow } from '@/app/api/cx/tl/disputes/route';

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
function IQSBadge({ score }: { score: number }) {
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
function EvaluatedChatsSection() {
  const [chats,      setChats]      = useState<TLChatRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [agents,     setAgents]     = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page,       setPage]       = useState(1);
  const [limit,      setLimit]      = useState(25);
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
      setTotal(data.total ?? 0);
      if (data.agents?.length) setAgents(data.agents);
    } finally {
      setLoading(false);
    }
  }, [agent, from, to, iqsMin, iqsMax, csat, limit]);

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
                {[5, 10, 25, 50].map(n => (
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

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Chat ID</th>
            <th style={th}>Agent</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS (Bot)</th>
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
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} style={td}>
                    <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : chats.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
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
                    {chat.botIqsScore != null ? <IQSBadge score={chat.botIqsScore} /> : <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>}
                  </td>
                  <td style={tdNum}>
                    {chat.iqsScore != null ? <IQSBadge score={chat.iqsScore} /> : <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>}
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
                    onDone={() => setExpandedId(null)}
                    onClose={() => setExpandedId(null)}
                    colSpan={7}
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

// ─── Section — Disputes (read-only history) ───────────────────────────────────
// TL no longer actions disputes — agent disputes go straight to QA. This is a
// historical, read-only view of disputes already resolved for their team.
function DisputesSection() {
  const status = 'resolved' as const;
  const [disputes,   setDisputes]   = useState<TLDisputeRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cx/tl/disputes?status=${status}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setDisputes(data.disputes ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const colCount = 9;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Chat ID</th>
          <th style={th}>Agent</th>
          <th style={th}>Raised By</th>
          <th style={{ ...th, textAlign: 'right' }}>IQS (Bot)</th>
          <th style={{ ...th, textAlign: 'right' }}>IQS (Agent)</th>
          <th style={{ ...th, textAlign: 'right' }}>Call IQS</th>
          <th style={th}>CSAT</th>
          <th style={th}>Raised</th>
          <th style={{ ...th, textAlign: 'right' }}>Outcome</th>
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
        ) : disputes.length === 0 ? (
          <tr>
            <td colSpan={colCount} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
              No resolved disputes yet
            </td>
          </tr>
        ) : (
          disputes.map(d => (
            <React.Fragment key={d.flagId}>
              <tr
                style={{ background: expandedId === d.chatId ? 'var(--qa-gray-50)' : undefined }}
                onMouseEnter={e => { if (expandedId !== d.chatId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                onMouseLeave={e => { if (expandedId !== d.chatId) e.currentTarget.style.background = ''; }}
              >
                <td style={tdMono}><ChatIdCell chatId={d.chatId} /></td>
                <td style={{ ...td, fontWeight: 500 }}>{d.agentName}</td>
                <td style={{ ...td, fontSize: 13 }}>
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                    background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                    borderRadius: 4, padding: '1px 5px', marginRight: 6, color: 'var(--qa-text-2)',
                  }}>{d.raisedBy}</span>
                  {d.raisedByName}
                </td>
                <td style={tdNum}>
                  {d.botIqsScore != null ? <IQSBadge score={d.botIqsScore} /> : <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>}
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
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {d.reviewNote && (
                      <span style={{ fontSize: 12, color: 'var(--qa-text-3)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={d.reviewNote}>{d.reviewNote}</span>
                    )}
                    <button
                      onClick={() => setExpandedId(prev => prev === d.chatId ? null : d.chatId)}
                      style={{
                        border: '1px solid var(--qa-border)', padding: '0 10px',
                        height: 28, borderRadius: 8, fontFamily: 'inherit', fontSize: 12,
                        color: 'var(--qa-text-2)', cursor: 'pointer',
                        background: expandedId === d.chatId ? 'var(--qa-gray-100)' : 'transparent',
                      }}
                    >
                      View
                    </button>
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
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)' }}>Disputed Params</span>
                          {d.challengedParams.map(cp => (
                            <span key={cp.param} title={cp.note} style={{
                              fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
                              borderRadius: 4, padding: '2px 6px', color: 'var(--qa-text-2)', cursor: cp.note ? 'help' : 'default',
                            }}>{cp.param}</span>
                          ))}
                        </div>
                      )}
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
                    onDone={() => setExpandedId(null)}
                    onClose={() => setExpandedId(null)}
                    colSpan={colCount}
                  />
                </>
              )}
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );
}

// ─── Section wrapper with count badge ─────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--qa-text)', margin: 0 }}>{title}</h2>
        {subtitle && <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{subtitle}</span>}
      </div>
      <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Root page ────────────────────────────────────────────────────────────────
export default function QualityChatsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '24px 0' }}>

      <Section
        title="Evaluated Chats"
        subtitle="Your team's recently evaluated chats"
      >
        <EvaluatedChatsSection />
      </Section>

      <Section
        title="Disputes Reviewed"
        subtitle="Disputes your team raised that QA has made a final decision on"
      >
        <DisputesSection />
      </Section>

    </div>
  );
}
