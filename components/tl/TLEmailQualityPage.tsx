'use client';

import React, { useState, useEffect, useCallback } from 'react';
import PeriodFilter, { DEFAULT_PERIOD, type PeriodState } from '@/components/quality/PeriodFilter';
import { periodBounds, robylonTicketUrl, paramLabel, intentLabel } from '@/lib/email/ui';
import { DEFAULT_EMAIL_PARAMETERS } from '@/lib/email/context-builder';
import EmailMessageView, { CustomerSummaryBlock, EmailHistoryPanel } from '@/components/quality/EmailContentRenderer';


interface AgentBreakdown {
  agent_name: string;
  total_replies: number;
  avg_score: number;
  compliance_errors: number;
  disputes_raised: number;
  overrides_count: number;
}

interface EvaluationItem {
  id: number;
  ticket_id: string;
  intent_l1?: string | null;
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
  qa_notes?: string;
  parameter_scores?: Record<string, any>;
  chat_id?: string;
  customer_email?: string;
  customer_phone?: string;
  thread_summary?: any;
}

// ─── Design Tokens & Styles ───────────────────────────────────────────────────
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
  height: 50,
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

export default function TLEmailQualityPage() {
  const [agents, setAgents] = useState<AgentBreakdown[]>([]);
  const [replies, setReplies] = useState<EvaluationItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAgent) params.set('agentName', selectedAgent);
      const { from, to } = periodBounds(period.period, period.customFrom, period.customTo);
      params.set('from', from);
      params.set('to', to);
      params.set('limit', '500');

      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setAgents(data.agentBreakdown || []);
        setReplies(data.items || []);
      }
    } catch (err) {
      console.error('Failed to load TL data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAgent, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const teamTotalReplies = agents.reduce((acc, a) => acc + Number(a.total_replies), 0);
  const teamTotalErrors = agents.reduce((acc, a) => acc + Number(a.compliance_errors), 0);
  const teamAvgScore = agents.length
    ? Math.round(agents.reduce((acc, a) => acc + Number(a.avg_score || 0), 0) / agents.length)
    : 0;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 8px 40px' }}>
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
            Quality Emails
          </h1>
          <p style={{ fontSize: 13, color: 'var(--qa-text-2)', margin: '4px 0 0' }}>
            Team-level email performance and individual member results
          </p>
        </div>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {/* ── KPI Cards (Consistent with QAAnalyticsDashboard / IQSRingCard) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <div style={{
          background: 'var(--qa-card)',
          border: '1px solid var(--qa-border)',
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
            Team Avg Quality
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--qa-text)', marginTop: 6, fontFamily: MONO }}>
            {teamAvgScore ? `${teamAvgScore}%` : 'N/A'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginTop: 4 }}>
            Overall team score
          </div>
        </div>

        <div style={{
          background: 'var(--qa-card)',
          border: '1px solid var(--qa-border)',
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
            Evaluated Replies
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--qa-text)', marginTop: 6, fontFamily: MONO }}>
            {teamTotalReplies}
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginTop: 4 }}>
            Outbound email responses
          </div>
        </div>

        <div style={{
          background: 'var(--qa-card)',
          border: '1px solid var(--qa-border)',
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
            Compliance Breaches
          </div>
          <div style={{
            fontSize: 26, fontWeight: 700, marginTop: 6, fontFamily: MONO,
            color: teamTotalErrors > 0 ? '#b91c1c' : 'var(--qa-text)',
          }}>
            {teamTotalErrors}
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginTop: 4 }}>
            Policy or financial errors
          </div>
        </div>

        <div style={{
          background: 'var(--qa-card)',
          border: '1px solid var(--qa-border)',
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
            Active Agents
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent)', marginTop: 6, fontFamily: MONO }}>
            {agents.length}
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginTop: 4 }}>
            Handling customer emails
          </div>
        </div>
      </div>

      {/* ── Member-Level Quality Performance Table ── */}
      <div style={{
        background: 'var(--qa-card)',
        border: '1px solid var(--qa-border)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 24,
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--qa-border-sub)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>
            Member-Level Quality Performance
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 220 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Agent Name</th>
                <th style={{ ...th, textAlign: 'right' }}>Replies</th>
                <th style={{ ...th, textAlign: 'right' }}>Avg Score</th>
                <th style={{ ...th, textAlign: 'right' }}>Disputes</th>
                <th style={{ ...th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const score = agent.avg_score || 0;
                const isSelected = selectedAgent === agent.agent_name;

                return (
                  <tr
                    key={agent.agent_name}
                    style={{ background: isSelected ? 'var(--qa-gray-50)' : undefined }}
                  >
                    <td style={{ ...td, fontWeight: 600 }}>
                      {agent.agent_name}
                    </td>
                    <td style={tdNum}>
                      {agent.total_replies}
                    </td>
                    <td style={tdNum}>
                      <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>{score}%</span>
                    </td>
                    <td style={tdNum}>
                      {agent.disputes_raised}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        onClick={() => setSelectedAgent(isSelected ? '' : agent.agent_name)}
                        style={{
                          height: 28, padding: '0 10px', borderRadius: 6,
                          border: '1px solid var(--qa-border)',
                          background: isSelected ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                          color: isSelected ? '#fff' : 'var(--qa-text)',
                          fontSize: 12, fontWeight: 500, cursor: 'pointer',
                        }}
                      >
                        {isSelected ? 'Clear' : 'Filter'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Evaluated Replies Feed (with Page 6 filters) ── */}
      <div style={{
        background: 'var(--qa-card)',
        border: '1px solid var(--qa-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        {/* Header & Filter Row */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--qa-border-sub)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>
              {selectedAgent ? `Replies by ${selectedAgent}` : 'All Team Email Replies'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-3)', marginTop: 2 }}>
              Showing {replies.length} replies
            </div>
          </div>

        </div>

        {/* Replies Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 220 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Ticket ID</th>
                <th style={th}>Agent</th>
                <th style={th}>Intent</th>
                <th style={{ ...th, textAlign: 'right' }}>IQS</th>
                <th style={th}>CSAT</th>
                <th style={{ ...th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                    Loading team email replies…
                  </td>
                </tr>
              ) : replies.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                    No replies matching selected filters
                  </td>
                </tr>
              ) : (
                replies.map((reply) => {
                  const isExpanded = expandedId === reply.message_id;
                  const score = reply.effective_score ?? reply.quality_score;
                  return (
                    <React.Fragment key={reply.message_id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : reply.message_id)}
                        style={{
                          background: isExpanded ? 'var(--qa-gray-50)' : undefined,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ''; }}
                      >
                        <td style={tdMono}>
                          <a
                            href={robylonTicketUrl(reply.chat_id ?? reply.ticket_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}
                          >
                            {reply.chat_id ?? `${reply.ticket_id.slice(0, 8)}…`}
                          </a>
                        </td>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {reply.agent_name || 'Unassigned'}
                        </td>
                        <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {intentLabel(reply.intent_l1)}
                        </td>
                        <td style={{ ...tdNum, color: 'var(--qa-text)', fontWeight: 600 }}>
                          {score != null ? Math.round(Number(score)) : <span style={{ color: 'var(--qa-text-3)' }}>—</span>}
                        </td>
                        <td style={{ ...td, color: 'var(--qa-text-3)' }}>—</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
                            {isExpanded ? 'Hide ▲' : 'View ▼'}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
                            <div style={{
                              background: 'var(--qa-gray-50)',
                              borderTop: '1px solid var(--qa-border-sub)',
                              padding: '20px 24px',
                              display: 'grid',
                              gridTemplateColumns: '1.2fr 1fr',
                              gap: 24,
                            }}>
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

                                  <div style={{
                                    background: 'var(--qa-card)',
                                    border: '1px solid var(--qa-border)',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                  }}>
                                    <CustomerSummaryBlock
                                      threadSummary={reply.thread_summary}
                                      customerMessage={reply.customer_message}
                                      subjectLine={reply.subject_line}
                                    />
                                  </div>
                                </div>

                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                                    Agent Outbound Response
                                  </div>
                                  <div style={{
                                    background: 'var(--qa-card)',
                                    border: '1px solid var(--qa-border)',
                                    borderRadius: 8,
                                    padding: '12px 16px',
                                    maxHeight: 420,
                                    overflowY: 'auto',
                                  }}>
                                    <EmailMessageView
                                      content={reply.agent_reply_text}
                                      fallback="No text content."
                                    />
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                  Evaluator Feedback &amp; Parameters ({DEFAULT_EMAIL_PARAMETERS.length})
                                </div>
                                <div style={{
                                  border: '1px solid var(--qa-border)',
                                  borderRadius: 8,
                                  background: 'var(--qa-card)',
                                  overflow: 'hidden',
                                }}>
                                  {((reply.compliance_issues && reply.compliance_issues.length > 0) || reply.qa_notes) && (
                                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--qa-border-sub)', fontSize: 12, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {reply.compliance_issues && reply.compliance_issues.length > 0 && (
                                        <div style={{ color: '#b91c1c', fontWeight: 600 }}>Breaches: {reply.compliance_issues.join(', ')}</div>
                                      )}
                                      {reply.qa_notes && <div style={{ color: 'var(--qa-text-2)' }}>{reply.qa_notes}</div>}
                                    </div>
                                  )}
                                  {DEFAULT_EMAIL_PARAMETERS.map((def, idx) => {
                                    const scores = reply.parameter_scores;
                                    const val = [def.key, ...(def.aliases ?? [])].map(k => scores?.[k]).find(v => v !== undefined);
                                    const reason = scores?.__reasoning?.[def.key];
                                    return (
                                      <div key={def.key} style={{
                                        padding: '12px 16px',
                                        borderBottom: idx < DEFAULT_EMAIL_PARAMETERS.length - 1 ? '1px solid var(--qa-border-sub)' : 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                      }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--qa-text)' }}>{def.name}</div>
                                          <div style={{ fontSize: 11, color: 'var(--qa-text-3)', lineHeight: 1.3, marginTop: 2 }}>{def.description}</div>
                                          {reason && (
                                            <div style={{ fontSize: 11, color: 'var(--qa-text-2)', fontStyle: 'italic', marginTop: 4, lineHeight: 1.3 }}>💡 {reason}</div>
                                          )}
                                        </div>
                                        <div style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: 'var(--qa-text)', fontFamily: MONO }}>{paramLabel(val)}</div>
                                      </div>
                                    );
                                  })}
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
        </div>
      </div>
    </div>
  );
}
