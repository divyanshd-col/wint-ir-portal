'use client';

import React, { useState, useEffect, useCallback } from 'react';
import EmailMessageView, { stripHtml, CustomerSummaryBlock, EmailHistoryPanel } from '@/components/quality/EmailContentRenderer';


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

const chip: React.CSSProperties = {
  height: 32,
  padding: '0 12px',
  border: '1px solid var(--qa-border)',
  borderRadius: 8,
  background: 'var(--qa-card)',
  color: 'var(--qa-text)',
  fontSize: 13,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

const chipActive: React.CSSProperties = {
  ...chip,
  background: 'var(--qa-gray-700)',
  color: '#fff',
  borderColor: 'var(--qa-gray-700)',
};

export default function TLEmailQualityPage() {
  const [agents, setAgents] = useState<AgentBreakdown[]>([]);
  const [replies, setReplies] = useState<EvaluationItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [complianceMistakesOnly, setComplianceMistakesOnly] = useState<boolean>(false);
  const [thisWeekOnly, setThisWeekOnly] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAgent) params.set('agentName', selectedAgent);
      if (complianceMistakesOnly) params.set('complianceFailed', 'true');

      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setAgents(data.agentBreakdown || []);
        let items: EvaluationItem[] = data.items || [];
        if (thisWeekOnly) {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          items = items.filter(i => new Date(i.sent_at) >= sevenDaysAgo);
        }
        setReplies(items);
      }
    } catch (err) {
      console.error('Failed to load TL data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAgent, complianceMistakesOnly, thisWeekOnly]);

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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Quality Emails
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2)', margin: '4px 0 0' }}>
          Team-level email performance, compliance breaches, and individual member trajectory
        </p>
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
              <col style={{ width: 170 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Agent Name</th>
                <th style={{ ...th, textAlign: 'right' }}>Replies</th>
                <th style={{ ...th, textAlign: 'right' }}>Avg Score</th>
                <th style={th}>Compliance</th>
                <th style={{ ...th, textAlign: 'right' }}>Disputes</th>
                <th style={th}>Trajectory</th>
                <th style={{ ...th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const score = agent.avg_score || 0;
                const isSelected = selectedAgent === agent.agent_name;
                const isHigh = score >= 85;

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
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
                        fontFamily: MONO, fontWeight: 600,
                        background: score >= 85 ? '#dcfce7' : score >= 70 ? '#fef9c3' : '#fee2e2',
                        color: score >= 85 ? '#15803d' : score >= 70 ? '#854d0e' : '#b91c1c',
                      }}>
                        {score}%
                      </span>
                    </td>
                    <td style={td}>
                      {agent.compliance_errors > 0 ? (
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>
                          ⚠️ {agent.compliance_errors} errors
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                          ✓ 0 errors
                        </span>
                      )}
                    </td>
                    <td style={tdNum}>
                      {agent.disputes_raised}
                    </td>
                    <td style={td}>
                      <span style={{
                        fontSize: 12, fontWeight: 600,
                        color: isHigh ? 'var(--accent)' : '#d97706',
                      }}>
                        {isHigh ? '↑ Consistent High' : '↓ Needs Coaching'}
                      </span>
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

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setComplianceMistakesOnly(!complianceMistakesOnly)}
              style={complianceMistakesOnly ? chipActive : chip}
            >
              Compliance Failures Only
            </button>
            <button
              onClick={() => setThisWeekOnly(!thisWeekOnly)}
              style={thisWeekOnly ? chipActive : chip}
            >
              This Week Only
            </button>
          </div>
        </div>

        {/* Replies Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 100 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Sent At</th>
                <th style={th}>Agent</th>
                <th style={th}>Ticket ID</th>
                <th style={th}>Customer Context &amp; Reply</th>
                <th style={{ ...th, textAlign: 'right' }}>Score</th>
                <th style={th}>Compliance</th>
                <th style={{ ...th, textAlign: 'right' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                    Loading team email replies…
                  </td>
                </tr>
              ) : replies.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
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
                          {new Date(reply.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{' '}
                          <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>
                            {new Date(reply.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {reply.agent_name}
                        </td>
                        <td style={tdMono}>
                          {reply.ticket_id.slice(0, 8)}…
                        </td>
                        <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--qa-text-2)', marginRight: 6 }}>
                            {reply.customer_message ? `"${stripHtml(reply.customer_message).slice(0, 40)}…"` : 'Email:'}
                          </span>
                          <span style={{ color: 'var(--qa-text)' }}>
                            {reply.agent_reply_text ? stripHtml(reply.agent_reply_text).slice(0, 60) + '…' : '—'}
                          </span>
                        </td>
                        <td style={tdNum}>
                          {score != null ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
                              fontFamily: MONO, fontWeight: 600,
                              background: score >= 85 ? '#dcfce7' : score >= 70 ? '#fef9c3' : '#fee2e2',
                              color: score >= 85 ? '#15803d' : score >= 70 ? '#854d0e' : '#b91c1c',
                            }}>
                              {score}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--qa-text-3)' }}>—</span>
                          )}
                        </td>
                        <td style={td}>
                          {reply.compliance_passed === false ? (
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>
                              ⚠️ Failed
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                              ✓ Passed
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
                            {isExpanded ? 'Hide ▲' : 'View ▼'}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
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
                                    maxHeight: 250,
                                    overflowY: 'auto',
                                  }}>
                                    <EmailMessageView
                                      content={reply.agent_reply_text}
                                      fallback="No text content."
                                    />
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-3)' }}>
                                  Evaluator Feedback &amp; Parameters
                                </div>
                                <div style={{
                                  background: 'var(--qa-card)',
                                  border: '1px solid var(--qa-border)',
                                  borderRadius: 8,
                                  padding: '12px 16px',
                                  fontSize: 13,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 8,
                                }}>
                                  {reply.compliance_issues && reply.compliance_issues.length > 0 && (
                                    <div style={{ color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>
                                      Breaches: {reply.compliance_issues.join(', ')}
                                    </div>
                                  )}
                                  {reply.qa_notes && (
                                    <div style={{ color: 'var(--qa-text-2)', fontSize: 12, lineHeight: 1.5 }}>
                                      {reply.qa_notes}
                                    </div>
                                  )}
                                  {reply.parameter_scores && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                                      {Object.entries(reply.parameter_scores).map(([k, v]) => (
                                        <div key={k} style={{ fontSize: 12, color: 'var(--qa-text-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
        </div>
      </div>
    </div>
  );
}
