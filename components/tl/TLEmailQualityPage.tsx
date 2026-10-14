'use client';

import React, { useState, useEffect, useCallback } from 'react';
import PeriodFilter, { DEFAULT_PERIOD, type PeriodState } from '@/components/quality/PeriodFilter';
import TicketLinkButton from '@/components/quality/TicketLinkButton';
import { periodBounds, paramLabel, intentLabel, disputeLabel } from '@/lib/email/ui';
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
  dispute_notes?: string;
  updated_at?: string;
  reviewed_at?: string;
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


// ─── Disputes (same flow as Quality Chats: raised -> TL resolves or forwards to QA -> history) ──
const dateOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const actionBtn: React.CSSProperties = {
  height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid var(--qa-border)',
  background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};

function EmailDisputesSection({ queue, period, onChanged }: { queue: 'tl_pending' | 'tl_history'; period: PeriodState; onChanged: () => void }) {
  const [rows, setRows] = useState<EvaluationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const pending = queue === 'tl_pending';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = periodBounds(period.period, period.customFrom, period.customTo);
      const params = new URLSearchParams({ disputeQueue: queue, from, to, limit: '500' });
      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      const data = await res.json();
      if (data.ok) setRows(data.items || []);
    } catch (err) {
      console.error('Failed to load email disputes:', err);
    } finally {
      setLoading(false);
    }
  }, [queue, period]);

  useEffect(() => { load(); }, [load]);

  const act = async (item: EvaluationItem, action: 'forward_dispute' | 'tl_resolve_dispute', notes?: string) => {
    setActioning(item.message_id);
    setError(null);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, messageId: item.message_id, notes }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setRows(prev => prev.filter(r => r.message_id !== item.message_id));
      onChanged();
    } catch {
      setError(action === 'forward_dispute' ? 'Could not forward that dispute — please retry.' : 'Could not resolve that dispute — please retry.');
    } finally {
      setActioning(null);
    }
  };

  const resolveAtTL = (item: EvaluationItem) => {
    const note = prompt('Enter a note explaining why this query was resolved at TL level:');
    if (note === null) return;
    act(item, 'tl_resolve_dispute', note || 'Resolved query at TL level');
  };

  const agentsInRows = Array.from(new Set(rows.map(r => r.agent_name).filter(Boolean))).sort();
  const shown = rows.filter(r =>
    (!agentFilter || r.agent_name === agentFilter) &&
    (!outcomeFilter || r.dispute_status === outcomeFilter));
  const colCount = 7;
  const field: React.CSSProperties = { height: 32, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12 };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
      {error && (
        <div style={{ padding: '10px 16px', fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderBottom: '1px solid var(--qa-border)' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--qa-border)', background: 'var(--qa-gray-50)' }}>
        {agentsInRows.length > 0 && (
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} style={field}>
            <option value="">All Agents</option>
            {agentsInRows.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {!pending && (
          <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)} style={field}>
            <option value="">All Outcomes</option>
            <option value="Under_Review">Forwarded to QA</option>
            <option value="TL_Resolved">Resolved by TL</option>
            <option value="Resolved">Resolved by QA</option>
            <option value="Rejected">Rejected by QA</option>
          </select>
        )}
        {(agentFilter || outcomeFilter) && (
          <button onClick={() => { setAgentFilter(''); setOutcomeFilter(''); }} style={actionBtn}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--qa-text-3)' }}>
          {loading ? 'Loading…' : `Showing ${shown.length} of ${rows.length}`}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 130 }} />
          <col />
          <col style={{ width: 90 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: pending ? 260 : 90 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>Ticket ID</th>
            <th style={th}>Agent</th>
            <th style={{ ...th, textAlign: 'right' }}>IQS</th>
            <th style={th}>CSAT</th>
            <th style={th}>{pending ? 'Raised' : 'Updated'}</th>
            <th style={th}>{pending ? 'Status' : 'Outcome'}</th>
            <th style={{ ...th, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colCount} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>Loading disputes…</td></tr>
          ) : shown.length === 0 ? (
            <tr><td colSpan={colCount} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
              {pending ? 'No disputes waiting for review' : 'No reviewed disputes'}
            </td></tr>
          ) : shown.map(item => {
            const isOpen = expandedId === item.message_id;
            const score = item.effective_score ?? item.quality_score;
            return (
              <React.Fragment key={item.message_id}>
                <tr
                  onClick={() => setExpandedId(isOpen ? null : item.message_id)}
                  style={{ background: isOpen ? 'var(--qa-gray-50)' : undefined, cursor: 'pointer' }}
                >
                  <td style={tdMono}><TicketLinkButton id={item.chat_id ?? item.ticket_id} label={item.chat_id ?? `${item.ticket_id.slice(0, 8)}…`} /></td>
                  <td style={{ ...td, fontWeight: 500 }}>{item.agent_name || 'Unassigned'}</td>
                  <td style={{ ...tdNum, color: 'var(--qa-text)', fontWeight: 600 }}>
                    {score != null ? Math.round(Number(score)) : <span style={{ color: 'var(--qa-text-3)' }}>—</span>}
                  </td>
                  <td style={{ ...td, color: 'var(--qa-text-3)' }}>—</td>
                  <td style={{ ...td, fontSize: 13, color: 'var(--qa-text-2)' }}>{dateOf(pending ? item.updated_at : (item.reviewed_at ?? item.updated_at))}</td>
                  <td style={{ ...td, fontSize: 13 }}>{disputeLabel(item.dispute_status)}</td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {pending && (
                        <>
                          <button style={actionBtn} disabled={actioning === item.message_id} onClick={() => resolveAtTL(item)}>Resolve</button>
                          <button style={actionBtn} disabled={actioning === item.message_id} onClick={() => act(item, 'forward_dispute')}>
                            {actioning === item.message_id ? '…' : 'Forward to QA'}
                          </button>
                        </>
                      )}
                      <button onClick={() => setExpandedId(isOpen ? null : item.message_id)} style={{ background: 'none', border: 0, fontSize: 12, color: 'var(--qa-text-2)', cursor: 'pointer' }}>
                        {isOpen ? 'Hide ▲' : 'View ▼'}
                      </button>
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={colCount} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
                      <div style={{ background: 'var(--qa-gray-50)', borderTop: '1px solid var(--qa-border-sub)', padding: '20px 24px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                              Dispute raised by {item.agent_name || 'agent'}
                            </div>
                            <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '12px 16px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                              {item.dispute_notes || '—'}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                              Agent Outbound Response
                            </div>
                            <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '12px 16px', maxHeight: 420, overflowY: 'auto' }}>
                              <EmailMessageView content={item.agent_reply_text} fallback="No text content." />
                            </div>
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                            Customer Context / Query
                          </div>
                          <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '14px 16px' }}>
                            <CustomerSummaryBlock threadSummary={item.thread_summary} customerMessage={item.customer_message} subjectLine={item.subject_line} />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TLEmailQualityPage() {
  const [agents, setAgents] = useState<AgentBreakdown[]>([]);
  const [replies, setReplies] = useState<EvaluationItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<'evaluated' | 'raised' | 'reviewed'>('evaluated');
  const [counts, setCounts] = useState<{ evaluated: number; raised: number; reviewed: number } | null>(null);
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
        if (data.summary) setCounts({ evaluated: data.summary.completedCount, raised: data.summary.tlPendingDisputesCount, reviewed: data.summary.tlHistoryDisputesCount });
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

      {/* ── Tabs (same as Quality Chats) ── */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 4, width: 'fit-content', marginBottom: 20 }}>
        {([
          ['evaluated', 'Evaluated Emails', counts?.evaluated],
          ['raised', 'Disputes Raised', counts?.raised],
          ['reviewed', 'Reviewed Disputes', counts?.reviewed],
        ] as const).map(([key, label, n]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                height: 36, padding: '0 16px', border: 'none', borderRadius: 8,
                background: active ? 'var(--qa-gray-700)' : 'transparent',
                color: active ? '#fff' : 'var(--qa-text-2)',
                fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 500 : 400,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {label}
              {n != null && (key === 'evaluated' || n > 0 || key === 'reviewed') && (
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600, lineHeight: '18px', background: active ? 'rgba(255,255,255,0.2)' : 'var(--qa-gray-100)', color: active ? '#fff' : 'var(--qa-text-2)' }}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'raised' && <EmailDisputesSection queue="tl_pending" period={period} onChanged={fetchData} />}
      {tab === 'reviewed' && <EmailDisputesSection queue="tl_history" period={period} onChanged={fetchData} />}

      {tab === 'evaluated' && (
      <>
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
                          <TicketLinkButton id={reply.chat_id ?? reply.ticket_id} label={reply.chat_id ?? `${reply.ticket_id.slice(0, 8)}…`} />
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
      </>
      )}
    </div>
  );
}
