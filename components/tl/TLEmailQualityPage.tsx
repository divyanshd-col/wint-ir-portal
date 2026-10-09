'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import EmailMessageView, { stripHtml, CustomerSummaryBlock, EmailHistoryPanel } from '@/components/quality/EmailContentRenderer';

// ─── Design Tokens & Styles (Identical to QualityChatsPage) ────────────────────
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const th: React.CSSProperties = {
  height: 40,
  background: 'var(--qa-gray-50)',
  borderBottom: '1px solid var(--qa-border)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--qa-text-2)',
  fontWeight: 500,
  textAlign: 'left',
  padding: '0 16px',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  height: 52,
  padding: '0 16px',
  borderBottom: '1px solid var(--qa-border-sub)',
  fontSize: 14,
  color: 'var(--qa-text)',
  verticalAlign: 'middle',
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: MONO,
  fontSize: 13,
  color: 'var(--qa-text-2)',
};

const tdNum: React.CSSProperties = {
  ...td,
  textAlign: 'right',
  fontFamily: MONO,
  fontSize: 13,
};

const chip: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  border: '1px solid var(--qa-border)',
  borderRadius: 8,
  background: 'var(--qa-card)',
  color: 'var(--qa-text)',
  fontSize: 12,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  cursor: 'pointer',
};

const chipActive: React.CSSProperties = {
  ...chip,
  background: 'var(--qa-gray-700)',
  color: '#fff',
  borderColor: 'var(--qa-gray-700)',
};

const inputStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--qa-border)',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  background: 'var(--qa-card)',
  color: 'var(--qa-text)',
  outline: 'none',
};

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── Score Badges ─────────────────────────────────────────────────────────────
function IQSBadge({ score }: { score: number | string | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13, fontWeight: 500 }}>NIL</span>;
  const num = Math.round(Number(score));
  if (isNaN(num)) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 36,
        height: 24,
        borderRadius: 6,
        fontSize: 12,
        fontFamily: MONO,
        background: 'var(--qa-fill-light)',
        color: 'var(--qa-text-2)',
        border: '1px solid var(--qa-border)',
      }}
    >
      {num}
    </span>
  );
}

function ScoreRing({ score, size = 64 }: { score: number | string | null; size?: number }) {
  const num = score != null ? Math.round(Number(score)) : null;
  if (num == null || isNaN(num)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
        <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-border-sub, #f1f5f9)" strokeWidth="5" />
        <text
          x="32"
          y="33"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="13"
          fontWeight="700"
          fill="var(--qa-text-3)"
          fontFamily={MONO}
        >
          NIL
        </text>
      </svg>
    );
  }
  const RING_C = 169.6;
  const clamped = Math.max(0, Math.min(100, num));
  const offset = (((100 - clamped) / 100) * RING_C).toFixed(1);
  const color = clamped >= 85 ? '#16a34a' : clamped >= 70 ? '#d97706' : '#dc2626';

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-border-sub, #f1f5f9)" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        r="27"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="169.6"
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
        style={{ transition: 'stroke-dashoffset 0.3s' }}
      />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="16"
        fontWeight="700"
        fill="var(--qa-text)"
        fontFamily={MONO}
      >
        {num}%
      </text>
    </svg>
  );
}

export function DisputeStatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let label = '';
  let bg = '#f4f4f5';
  let color = '#52525b';
  let border = '#e4e4e7';

  if (s === 'raised' || s === 'pending') {
    label = 'Dispute raised by IR';
    bg = '#fefce8';
    color = '#854d0e';
    border = '#fef08a';
  } else if (s === 'under_review' || s === 'tl_forwarded') {
    label = 'Forwarded to QA';
    bg = '#eff6ff';
    color = '#1d4ed8';
    border = '#bfdbfe';
  } else if (s === 'resolved') {
    label = 'Resolved by QA';
    bg = '#f0fdf4';
    color = '#166534';
    border = '#bbf7d0';
  } else if (s === 'rejected' || s === 'cancelled') {
    label = 'Rejected';
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

function renderParamBadge(v: any) {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'yes') {
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '1px 6px', borderRadius: 4 }}>
        ✓ Yes
      </span>
    );
  }
  if (s === 'partial') {
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>
        ½ Partial
      </span>
    );
  }
  if (s === 'no') {
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: 4 }}>
        ✗ No
      </span>
    );
  }
  return <span style={{ fontWeight: 700, color: 'var(--qa-text)', fontFamily: MONO }}>{v}%</span>;
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 10,
        fontWeight: 600,
        lineHeight: '18px',
        background: active ? 'rgba(255,255,255,0.2)' : 'var(--qa-gray-100)',
        color: active ? '#fff' : 'var(--qa-text-2)',
      }}
    >
      {count}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface EvaluationItem {
  id: number;
  ticket_id: string;
  message_id: string;
  agent_name: string;
  sent_at: string;
  subject_line?: string;
  customer_message?: string;
  agent_reply_text?: string;
  quality_score?: number;
  qa_override_score?: number;
  effective_score?: number;
  compliance_passed?: boolean;
  compliance_issues?: string[];
  dispute_status?: string;
  dispute_notes?: string;
  qa_notes?: string;
  parameter_scores?: Record<string, any>;
  chat_id?: string;
  customer_email?: string;
  customer_phone?: string;
  thread_summary?: any;
}

// ─── Section A — Evaluated Emails (Identical to EvaluatedChatsSection) ─────────
function EvaluatedEmailsSection({ onTotalChange }: { onTotalChange?: (count: number) => void }) {
  const [replies, setReplies] = useState<EvaluationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [pageSizeDrop, setPageSizeDrop] = useState(false);

  // Filters
  const [ticketSearch, setTicketSearch] = useState('');
  const [agent, setAgent] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');
  const [breachesOnly, setBreachesOnly] = useState(false);

  const fetchEmails = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String((pg - 1) * limit));
      if (ticketSearch) params.set('search', ticketSearch);
      if (agent) params.set('agentName', agent);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (iqsMin) params.set('minScore', iqsMin);
      if (iqsMax) params.set('maxScore', iqsMax);
      if (breachesOnly) params.set('complianceFailed', 'true');

      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setReplies(data.items || []);
        const totalCount = data.summary?.totalCount ?? (data.items || []).length;
        setTotal(totalCount);
        onTotalChange?.(totalCount);

        if (data.agentBreakdown?.length) {
          setAgents(data.agentBreakdown.map((a: any) => a.agent_name).filter(Boolean));
        }
      }
    } catch (err) {
      console.error('Failed to load evaluated emails:', err);
    } finally {
      setLoading(false);
    }
  }, [ticketSearch, agent, from, to, iqsMin, iqsMax, breachesOnly, limit, onTotalChange]);

  useEffect(() => {
    fetchEmails(page);
  }, [fetchEmails, page]);

  function applyFilters() {
    setPage(1);
    setPageSizeDrop(false);
    fetchEmails(1);
  }

  function clearFilters() {
    setTicketSearch('');
    setAgent('');
    setFrom('');
    setTo('');
    setIqsMin('');
    setIqsMax('');
    setBreachesOnly(false);
    setPage(1);
    fetchEmails(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      {/* ── Filter Bar ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          padding: '10px 16px',
          borderBottom: '1px solid var(--qa-border)',
          background: 'var(--qa-gray-50)',
        }}
      >
        <input
          type="text"
          value={ticketSearch}
          onChange={e => setTicketSearch(e.target.value)}
          placeholder="Search Ticket / Email…"
          style={{ ...inputStyle, width: 140 }}
        />
        {agents.length > 0 && (
          <select value={agent} onChange={e => setAgent(e.target.value)} style={{ ...inputStyle, paddingRight: 4 }}>
            <option value="">All Agents</option>
            {agents.map(a => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} placeholder="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} placeholder="To" />
        <input
          type="number"
          value={iqsMin}
          onChange={e => setIqsMin(e.target.value)}
          placeholder="IQS min"
          style={{ ...inputStyle, width: 70 }}
        />
        <input
          type="number"
          value={iqsMax}
          onChange={e => setIqsMax(e.target.value)}
          placeholder="IQS max"
          style={{ ...inputStyle, width: 70 }}
        />
        <button
          style={breachesOnly ? chipActive : chip}
          onClick={() => setBreachesOnly(prev => !prev)}
        >
          Breaches Only
        </button>
        <button
          onClick={applyFilters}
          style={{ ...chip, background: 'var(--qa-gray-700)', color: '#fff', borderColor: 'var(--qa-gray-700)' }}
        >
          Apply
        </button>
        <button onClick={clearFilters} style={chip}>
          Clear
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
            {loading ? 'Loading…' : `Showing ${replies.length} of ${total}`}
          </span>
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              title="Rows per page"
              onClick={() => setPageSizeDrop(p => !p)}
              style={{
                width: 28,
                height: 28,
                border: '1px solid var(--qa-border)',
                borderRadius: 6,
                background: 'var(--qa-card)',
                color: 'var(--qa-text-2)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            {pageSizeDrop && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 4,
                  zIndex: 50,
                  background: 'var(--qa-card)',
                  border: '1px solid var(--qa-border)',
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                  minWidth: 130,
                  overflow: 'hidden',
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                  Rows per page
                </div>
                {[20, 50, 100].map(n => (
                  <div
                    key={n}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--qa-text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontWeight: limit === n ? 600 : 400,
                      background: limit === n ? 'var(--qa-gray-50)' : 'transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light)')}
                    onMouseLeave={e => (e.currentTarget.style.background = limit === n ? 'var(--qa-gray-50)' : 'transparent')}
                    onClick={() => {
                      setLimit(n);
                      setPage(1);
                      setPageSizeDrop(false);
                    }}
                  >
                    {limit === n && <span style={{ fontSize: 10 }}>✓</span>} {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 140 }} />
          <col style={{ width: 160 }} />
          <col />
          <col style={{ width: 150 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 80 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>Ticket ID</th>
            <th style={th}>Agent</th>
            <th style={th}>Subject / Context</th>
            <th style={th}>Sent At</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS</th>
            <th style={th}>Compliance</th>
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
          ) : replies.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                No evaluated emails found for your team
              </td>
            </tr>
          ) : (
            replies.map(reply => {
              const score = reply.effective_score ?? reply.quality_score ?? null;
              const isExpanded = expandedId === reply.message_id;

              return (
                <React.Fragment key={reply.message_id}>
                  <tr
                    style={{ background: isExpanded ? 'var(--qa-gray-50)' : undefined }}
                    onMouseEnter={e => {
                      if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)';
                    }}
                    onMouseLeave={e => {
                      if (!isExpanded) e.currentTarget.style.background = '';
                    }}
                  >
                    <td style={tdMono}>
                      <span style={{ fontFamily: MONO, fontSize: 13, color: 'var(--qa-text-2)' }}>
                        {reply.ticket_id}
                      </span>
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{reply.agent_name || '—'}</td>
                    <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--qa-text-2)', marginRight: 6 }}>
                        {reply.subject_line || 'Email'}
                      </span>
                      <span style={{ color: 'var(--qa-text)' }}>
                        {reply.customer_message ? `— "${stripHtml(reply.customer_message).slice(0, 50)}…"` : ''}
                      </span>
                    </td>
                    <td style={{ ...td, color: 'var(--qa-text-2)', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {fmtDate(reply.sent_at)}{' '}
                      <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>{fmtTime(reply.sent_at)}</span>
                    </td>
                    <td style={tdNum}>
                      <IQSBadge score={score} />
                    </td>
                    <td style={td}>
                      {reply.compliance_passed === false ? (
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>⚠️ Failed</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>✓ Passed</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        onClick={() => setExpandedId(prev => (prev === reply.message_id ? null : reply.message_id))}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--qa-text)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        View{' '}
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--qa-text-2)',
                            transform: isExpanded ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.15s',
                            display: 'inline-block',
                          }}
                        >
                          ▾
                        </span>
                      </button>
                    </td>
                  </tr>

                  {/* ── Expanded Evaluation Inspection ── */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
                        <div
                          style={{
                            background: 'var(--qa-gray-50)',
                            borderTop: '1px solid var(--qa-border-sub)',
                            padding: '20px 24px',
                            display: 'grid',
                            gridTemplateColumns: '1.2fr 1fr',
                            gap: 24,
                          }}
                        >
                          {/* Left Column: Customer Context & Agent Outbound Response */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                  Customer Context / Query
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setHistoryOpen(prev => ({ ...prev, [reply.message_id]: !prev[reply.message_id] }))}
                                  style={{
                                    height: 26,
                                    padding: '0 10px',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid var(--qa-border)',
                                    background: historyOpen[reply.message_id] ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                                    color: historyOpen[reply.message_id] ? '#fff' : 'var(--qa-text-2)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    transition: 'all 0.15s',
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                  </svg>
                                  {historyOpen[reply.message_id] ? 'Hide History' : 'History'}
                                </button>
                              </div>

                              {historyOpen[reply.message_id] && (
                                <EmailHistoryPanel
                                  customerEmail={reply.customer_email}
                                  chatId={reply.chat_id}
                                  ticketId={reply.ticket_id}
                                  onClose={() => setHistoryOpen(prev => ({ ...prev, [reply.message_id]: false }))}
                                />
                              )}

                              <div
                                style={{
                                  background: 'var(--qa-card)',
                                  border: '1px solid var(--qa-border)',
                                  borderRadius: 8,
                                  padding: '14px 16px',
                                }}
                              >
                                <CustomerSummaryBlock
                                  threadSummary={reply.thread_summary}
                                  customerMessage={reply.customer_message}
                                  subjectLine={reply.subject_line}
                                />
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                                Agent Outbound Response ({reply.agent_name || 'Agent'})
                              </div>
                              <div
                                style={{
                                  background: 'var(--qa-card)',
                                  border: '1px solid var(--qa-border)',
                                  borderRadius: 8,
                                  padding: '14px 16px',
                                  maxHeight: 260,
                                  overflowY: 'auto',
                                }}
                              >
                                <EmailMessageView content={reply.agent_reply_text} fallback="No outbound text recorded." />
                              </div>
                            </div>
                          </div>

                          {/* Right Column: Score Breakdown & Parameters */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div
                              style={{
                                background: 'var(--qa-card)',
                                border: '1px solid var(--qa-border)',
                                borderRadius: 8,
                                padding: '16px 20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 16,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <ScoreRing score={score} size={64} />
                                <div>
                                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                    Quality Score
                                  </div>
                                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--qa-text)', marginTop: 2, fontFamily: MONO }}>
                                    {score != null ? `${Math.round(Number(score))}%` : 'N/A'}
                                  </div>
                                  {reply.qa_override_score != null && (
                                    <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600 }}>
                                      Adjusted from {Math.round(Number(reply.quality_score))}%
                                    </div>
                                  )}
                                </div>
                              </div>
                              {reply.dispute_status && reply.dispute_status !== 'None' && (
                                <DisputeStatusPill status={reply.dispute_status} />
                              )}
                            </div>

                            <div
                              style={{
                                background: 'var(--qa-card)',
                                border: '1px solid var(--qa-border)',
                                borderRadius: 8,
                                padding: '14px 16px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 10,
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                Evaluation Parameters
                              </div>

                              {reply.compliance_issues && reply.compliance_issues.length > 0 && (
                                <div style={{ color: '#b91c1c', fontSize: 12, fontWeight: 600, background: '#fee2e2', padding: '6px 10px', borderRadius: 6 }}>
                                  ⚠️ Compliance Breach: {reply.compliance_issues.join(', ')}
                                </div>
                              )}

                              {reply.qa_notes && (
                                <div style={{ color: 'var(--qa-text-2)', fontSize: 12, lineHeight: 1.5, background: 'var(--qa-fill-light)', padding: '8px 10px', borderRadius: 6 }}>
                                  <strong>Evaluator Note:</strong> {reply.qa_notes}
                                </div>
                              )}

                              {reply.parameter_scores && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                                  {Object.entries(reply.parameter_scores).map(([k, v]) => (
                                    <div
                                      key={k}
                                      style={{
                                        fontSize: 12,
                                        color: 'var(--qa-text-2)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '4px 0',
                                        borderBottom: '1px solid var(--qa-border-sub)',
                                      }}
                                    >
                                      <span style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}:</span>
                                      {renderParamBadge(v)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 16px',
            borderTop: '1px solid var(--qa-border)',
          }}
        >
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...chip, opacity: page === 1 ? 0.4 : 1 }}>
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
            Page {page} of {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...chip, opacity: page === totalPages ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Section B & C — Email Disputes (Pending & Reviewed) ──────────────────────
function EmailDisputesSection({
  status,
  onTotalChange,
}: {
  status: 'pending' | 'reviewed';
  onTotalChange?: (count: number) => void;
}) {
  const [disputes, setDisputes] = useState<EvaluationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/email-evaluations?disputeStatus=${status}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        const list: EvaluationItem[] = data.items || [];
        setDisputes(list);
        onTotalChange?.(list.length);
      }
    } catch (err) {
      console.error('Failed to load email disputes:', err);
    } finally {
      setLoading(false);
    }
  }, [status, onTotalChange]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  async function forwardToQA(messageId: string) {
    setActioning(messageId);
    setActionError(null);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forward_dispute', messageId }),
      });
      if (res.ok) {
        setDisputes(prev => {
          const next = prev.filter(d => d.message_id !== messageId);
          onTotalChange?.(next.length);
          return next;
        });
      } else {
        setActionError('Could not forward dispute — please retry.');
      }
    } catch {
      setActionError('Could not forward dispute — please retry.');
    } finally {
      setActioning(null);
    }
  }

  async function resolveAtTLLevel(messageId: string) {
    const note = prompt('Enter a note explaining the resolution:');
    if (note === null) return;
    setActioning(messageId);
    setActionError(null);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_dispute', messageId, decision: 'Resolved', notes: note || 'Resolved by TL' }),
      });
      if (res.ok) {
        setDisputes(prev => {
          const next = prev.filter(d => d.message_id !== messageId);
          onTotalChange?.(next.length);
          return next;
        });
      } else {
        setActionError('Could not resolve dispute — please retry.');
      }
    } catch {
      setActionError('Could not resolve dispute — please retry.');
    } finally {
      setActioning(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(disputes.length / limit));
  const pagedDisputes = disputes.slice((page - 1) * limit, page * limit);

  return (
    <div>
      {actionError && (
        <div style={{ padding: '10px 16px', fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderBottom: '1px solid var(--qa-border)' }}>
          {actionError}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 140 }} />
          <col style={{ width: 150 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 160 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>Ticket ID</th>
            <th style={th}>Agent</th>
            <th style={th}>Dispute Reason / Notes</th>
            <th style={th}>Sent At</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS</th>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} style={td}>
                    <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: '60%' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : pagedDisputes.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                {status === 'pending' ? 'No pending email disputes' : 'No reviewed email disputes'}
              </td>
            </tr>
          ) : (
            pagedDisputes.map(dispute => {
              const isExpanded = expandedId === dispute.message_id;
              const isActioning = actioning === dispute.message_id;

              return (
                <React.Fragment key={dispute.message_id}>
                  <tr
                    style={{ background: isExpanded ? 'var(--qa-gray-50)' : undefined }}
                    onMouseEnter={e => {
                      if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)';
                    }}
                    onMouseLeave={e => {
                      if (!isExpanded) e.currentTarget.style.background = '';
                    }}
                  >
                    <td style={tdMono}>{dispute.ticket_id}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{dispute.agent_name || '—'}</td>
                    <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--qa-text)' }}>
                        {dispute.dispute_notes || 'Score disputed by agent'}
                      </span>
                    </td>
                    <td style={{ ...td, color: 'var(--qa-text-2)', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {fmtDate(dispute.sent_at)}
                    </td>
                    <td style={tdNum}>
                      <IQSBadge score={dispute.effective_score ?? dispute.quality_score ?? null} />
                    </td>
                    <td style={td}>
                      <DisputeStatusPill status={dispute.dispute_status || 'Raised'} />
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {status === 'pending' ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            onClick={() => forwardToQA(dispute.message_id)}
                            disabled={isActioning}
                            style={{
                              height: 26,
                              padding: '0 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 500,
                              background: 'var(--qa-gray-700)',
                              color: '#fff',
                              border: 'none',
                              cursor: 'pointer',
                              opacity: isActioning ? 0.5 : 1,
                            }}
                          >
                            Forward
                          </button>
                          <button
                            onClick={() => resolveAtTLLevel(dispute.message_id)}
                            disabled={isActioning}
                            style={{
                              height: 26,
                              padding: '0 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 500,
                              background: 'var(--qa-card)',
                              color: 'var(--qa-text)',
                              border: '1px solid var(--qa-border)',
                              cursor: 'pointer',
                              opacity: isActioning ? 0.5 : 1,
                            }}
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => setExpandedId(p => (p === dispute.message_id ? null : dispute.message_id))}
                            style={{ background: 'none', border: 0, padding: 0, color: 'var(--qa-text-2)', cursor: 'pointer', fontSize: 12 }}
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setExpandedId(p => (p === dispute.message_id ? null : dispute.message_id))}
                          style={{
                            background: 'none',
                            border: 0,
                            padding: 0,
                            fontSize: 13,
                            fontWeight: 500,
                            color: 'var(--qa-text)',
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? 'Hide ▲' : 'View ▼'}
                        </button>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{ padding: '16px 20px', background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-3)', marginBottom: 6 }}>
                              Customer Inquiry
                            </div>
                            <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '12px 14px' }}>
                              <CustomerSummaryBlock threadSummary={dispute.thread_summary} customerMessage={dispute.customer_message} subjectLine={dispute.subject_line} />
                            </div>

                            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-3)', margin: '14px 0 6px' }}>
                              Agent Outbound Reply
                            </div>
                            <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '12px 14px', maxHeight: 180, overflowY: 'auto' }}>
                              <EmailMessageView content={dispute.agent_reply_text} fallback="No content." />
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-3)' }}>
                              Dispute Information &amp; QA Feedback
                            </div>
                            <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '14px 16px', fontSize: 13 }}>
                              <div style={{ marginBottom: 10 }}>
                                <span style={{ fontWeight: 600, color: '#854d0e' }}>Agent Note: </span>
                                <span>{dispute.dispute_notes || 'Score disputed'}</span>
                              </div>
                              {dispute.qa_notes && (
                                <div style={{ marginBottom: 10, color: 'var(--qa-text-2)' }}>
                                  <span style={{ fontWeight: 600 }}>QA Notes: </span>
                                  <span>{dispute.qa_notes}</span>
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                                <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>IQS Score:</span>
                                <IQSBadge score={dispute.effective_score ?? dispute.quality_score ?? null} />
                                <DisputeStatusPill status={dispute.dispute_status || 'Raised'} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>

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

// ─── Root Page Component (Identical Tabbed Structure to QualityChatsPage) ──────
type Tab = 'evaluated' | 'disputes' | 'reviewed';

export default function TLEmailQualityPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') as Tab | null;

  const [tab, setTab] = useState<Tab>(
    initialTab && ['evaluated', 'disputes', 'reviewed'].includes(initialTab) ? initialTab : 'evaluated'
  );

  const [evaluatedCount, setEvaluatedCount] = useState<number | null>(null);
  const [disputeCount, setDisputeCount] = useState<number | null>(null);
  const [reviewedCount, setReviewedCount] = useState<number | null>(null);

  // Fetch initial summary counts
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email-evaluations?limit=1');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.summary) {
          setEvaluatedCount(data.summary.totalCount ?? null);
          setDisputeCount(data.summary.activeDisputesCount ?? 0);
          setReviewedCount(data.summary.reviewedDisputesCount ?? 0);
        }
      } catch (e) {
        console.error('Failed to load summary counts:', e);
      }
    })();
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 36,
    padding: '0 16px',
    border: 'none',
    borderRadius: 8,
    background: active ? 'var(--qa-gray-700)' : 'transparent',
    color: active ? '#fff' : 'var(--qa-text-2)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  });

  return (
    <div>
      {/* ── Page Header (Identical to QualityChatsPage) ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Quality Emails
        </h1>
      </div>

      {/* ── Tab Bar (Identical to QualityChatsPage) ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--qa-card)',
            border: '1px solid var(--qa-border)',
            borderRadius: 10,
            padding: 4,
            width: 'fit-content',
          }}
        >
          <button style={tabStyle(tab === 'evaluated')} onClick={() => setTab('evaluated')}>
            Evaluated Emails
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

      {/* ── Tab Contents ── */}
      <div style={{ display: tab === 'evaluated' ? 'block' : 'none' }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <EvaluatedEmailsSection onTotalChange={setEvaluatedCount} />
        </div>
      </div>

      <div style={{ display: tab === 'disputes' ? 'block' : 'none' }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <EmailDisputesSection status="pending" onTotalChange={setDisputeCount} />
        </div>
      </div>

      <div style={{ display: tab === 'reviewed' ? 'block' : 'none' }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <EmailDisputesSection status="reviewed" onTotalChange={setReviewedCount} />
        </div>
      </div>
    </div>
  );
}
