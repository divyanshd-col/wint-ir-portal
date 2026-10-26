'use client';

import React, { useState, useEffect, useCallback } from 'react';
import PeriodFilter, { DEFAULT_PERIOD, type PeriodState } from '@/components/quality/PeriodFilter';
import TicketLinkButton from '@/components/quality/TicketLinkButton';
import ScoreRing from '@/components/quality/ScoreRing';
import ParamScoreRow from '@/components/quality/ParamScoreRow';
import { usePaging, ShowingCount, Pager } from '@/components/quality/TablePaging';
import { periodBounds, intentLabel, disputeLabel, formatEmailDateTime } from '@/lib/email/ui';
import { DEFAULT_EMAIL_PARAMETERS } from '@/lib/email/context-builder';
import EmailMessageView, {
  CustomerSummaryBlock,
  CustomerCoreQueryCard,
  CustomerEmailThreadCard,
  EmailHistoryPanel,
  InternalNotesBlock,
  type InternalNote,
} from '@/components/quality/EmailContentRenderer';
import { DisputeThread } from '@/components/quality/DisputeThread';


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
  flag_id?: string;
  challenged_params?: { param: string; note?: string }[];
  reviewed_by?: string;
  updated_at?: string;
  reviewed_at?: string;
  internal_notes?: InternalNote[];
}

// ─── Design Tokens & Styles ───────────────────────────────────────────────────
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

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

  const [modalItem, setModalItem] = useState<EvaluationItem | null>(null);
  const [modalAction, setModalAction] = useState<'forward_dispute' | 'tl_resolve_dispute' | null>(null);
  const [modalNotes, setModalNotes] = useState('');

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
      setModalItem(null);
      setModalAction(null);
      setModalNotes('');
      onChanged();
    } catch {
      setError(action === 'forward_dispute' ? 'Could not forward that dispute — please retry.' : 'Could not resolve that dispute — please retry.');
    } finally {
      setActioning(null);
    }
  };

  const openResolveModal = (item: EvaluationItem) => {
    setModalItem(item);
    setModalAction('tl_resolve_dispute');
    setModalNotes('');
  };

  const openForwardModal = (item: EvaluationItem) => {
    setModalItem(item);
    setModalAction('forward_dispute');
    setModalNotes('');
  };

  const agentsInRows = Array.from(new Set(rows.map(r => r.agent_name).filter(Boolean))).sort();
  const shown = rows.filter(r =>
    (!agentFilter || r.agent_name === agentFilter) &&
    (!outcomeFilter || r.dispute_status === outcomeFilter));
  const paging = usePaging(shown, `${queue}|${agentFilter}|${outcomeFilter}|${period.period}|${period.customFrom}|${period.customTo}`);
  const colCount = 8;
  const field: React.CSSProperties = { height: 32, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12 };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      {error && (
        <div style={{ padding: '10px 16px', fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderBottom: '1px solid var(--qa-border)' }}>{error}</div>
      )}

      {/* Action Dialog Modal */}
      {modalItem && modalAction && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
        }}>
          <div style={{
            background: 'var(--qa-card, #FFFFFF)', borderRadius: 10, border: '1px solid var(--qa-border)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            maxWidth: 520, width: '100%', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--qa-text)' }}>
              {modalAction === 'tl_resolve_dispute' ? 'Resolve Dispute at TL Level' : 'Forward Dispute to QA'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--qa-text-2)' }}>
              Ticket: <strong style={{ fontFamily: MONO }}>{modalItem.ticket_id}</strong> · Agent: <strong>{modalItem.agent_name}</strong>
            </div>

            {modalItem.challenged_params && modalItem.challenged_params.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-3)' }}>Challenged:</span>
                {modalItem.challenged_params.map(cp => {
                  const def = DEFAULT_EMAIL_PARAMETERS.find(d => d.key === cp.param);
                  return (
                    <span key={cp.param} style={{
                      fontSize: 11, fontWeight: 600, background: 'var(--qa-fill-light, #F4F4F5)', border: '1px solid var(--qa-border)',
                      borderRadius: 4, padding: '2px 8px', color: 'var(--qa-text-2)',
                    }}>
                      {def?.name || cp.param}
                    </span>
                  );
                })}
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--qa-text-2)', background: 'var(--qa-gray-50)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--qa-border-sub)' }}>
              &ldquo;{modalItem.dispute_notes}&rdquo;
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--qa-text)', marginBottom: 6 }}>
                {modalAction === 'tl_resolve_dispute' ? 'Resolution explanation (required):' : 'Forward notes for QA (optional):'}
              </label>
              <textarea
                rows={3}
                value={modalNotes}
                onChange={e => setModalNotes(e.target.value)}
                placeholder={modalAction === 'tl_resolve_dispute' ? 'Explain resolution...' : 'Add context for QA...'}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--qa-border)',
                  background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, outline: 'none',
                  resize: 'vertical', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="button"
                onClick={() => { setModalItem(null); setModalAction(null); }}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid var(--qa-border)',
                  background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actioning === modalItem.message_id || (modalAction === 'tl_resolve_dispute' && !modalNotes.trim())}
                onClick={() => act(modalItem, modalAction, modalNotes)}
                style={{
                  height: 32, padding: '0 16px', borderRadius: 6, border: 'none',
                  background: 'var(--qa-gray-700, #111111)', color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: (modalAction === 'tl_resolve_dispute' && !modalNotes.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (modalAction === 'tl_resolve_dispute' && !modalNotes.trim()) ? 0.5 : 1,
                }}
              >
                {actioning === modalItem.message_id ? 'Saving…' : (modalAction === 'tl_resolve_dispute' ? 'Confirm Resolve' : 'Confirm Forward')}
              </button>
            </div>
          </div>
        </div>
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
        <div style={{ marginLeft: 'auto' }}>
          <ShowingCount shown={paging.pageItems.length} total={shown.length} loading={loading} pageSize={paging.pageSize} onPageSize={paging.setPageSize} />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 130 }} />
          <col style={{ width: 135 }} />
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
            <th style={th}>Date & Time</th>
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
          ) : paging.pageItems.length === 0 ? (
            <tr><td colSpan={colCount} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
              {pending ? 'No disputes waiting for review' : 'No reviewed disputes'}
            </td></tr>
          ) : paging.pageItems.map(item => {
            const isOpen = expandedId === item.message_id;
            const score = item.effective_score ?? item.quality_score;
            return (
              <React.Fragment key={item.message_id}>
                <tr
                  onClick={() => setExpandedId(isOpen ? null : item.message_id)}
                  style={{ background: isOpen ? 'var(--qa-gray-50)' : undefined, cursor: 'pointer' }}
                >
                  <td style={tdMono}>
                    <TicketLinkButton id={item.chat_id ?? item.ticket_id} label={item.chat_id ?? `${item.ticket_id.slice(0, 8)}…`} />
                    {item.customer_email && (
                      <div
                        title={`User Email: ${item.customer_email}`}
                        style={{
                          fontSize: 11,
                          color: 'var(--qa-text-3)',
                          fontFamily: SANS,
                          marginTop: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 150,
                        }}
                      >
                        {item.customer_email}
                      </div>
                    )}
                  </td>
                  {(() => {
                    const dt = formatEmailDateTime(item.sent_at);
                    return (
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, color: 'var(--qa-text)' }}>{dt.date}</div>
                        {dt.time && (
                          <div style={{ fontSize: 11, color: 'var(--qa-text-3)', marginTop: 2, fontFamily: MONO }}>
                            {dt.time}
                          </div>
                        )}
                      </td>
                    );
                  })()}
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
                          <button style={actionBtn} disabled={actioning === item.message_id} onClick={() => openResolveModal(item)}>Resolve</button>
                          <button style={actionBtn} disabled={actioning === item.message_id} onClick={() => openForwardModal(item)}>
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

                            {item.challenged_params && item.challenged_params.length > 0 && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)' }}>
                                  Challenged:
                                </span>
                                {item.challenged_params.map(cp => {
                                  const def = DEFAULT_EMAIL_PARAMETERS.find(d => d.key === cp.param);
                                  return (
                                    <span key={cp.param} title={cp.note} style={{
                                      fontSize: 11, fontWeight: 600, background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border)',
                                      borderRadius: 4, padding: '2px 8px', color: 'var(--qa-text)',
                                    }}>
                                      {def?.name || cp.param}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: '12px 16px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                              {item.dispute_notes || '—'}
                            </div>
                          </div>

                          {/* Dispute Thread */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                              Dispute Discussion Thread
                            </div>
                            <DisputeThread
                              flagId={item.flag_id || item.message_id}
                              agentNote={item.dispute_notes}
                              agentName={item.agent_name}
                              raisedByRole="agent"
                              raisedByName={item.agent_name}
                              reviewedBy={item.reviewed_by}
                              qaName={(item as any).qa_name || item.reviewed_by}
                              reviewerRole={item.dispute_status === 'TL_Resolved' ? 'tl' : 'quality'}
                              flaggedAt={item.sent_at}
                              reviewedAt={item.reviewed_at}
                              compact
                            />
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {/* 1. Customer Core Query (Separate & prominent) */}
                          <CustomerCoreQueryCard
                            threadSummary={item.thread_summary}
                            customerMessage={item.customer_message}
                            subjectLine={item.subject_line}
                            customerEmail={item.customer_email}
                            parameterScores={item.parameter_scores}
                          />

                          {/* 2. Customer Inbound Email Thread */}
                          {item.customer_message && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                  Customer Inbound Email Thread
                                </div>
                                {item.customer_email && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: '#1d4ed8',
                                      background: '#eff6ff',
                                      border: '1px solid #bfdbfe',
                                      padding: '1px 7px',
                                      borderRadius: 4,
                                      fontWeight: 500,
                                      fontFamily: MONO,
                                    }}
                                    title={`User Email: ${item.customer_email}`}
                                  >
                                    {item.customer_email}
                                  </span>
                                )}
                              </div>
                              <CustomerEmailThreadCard
                                customerMessage={item.customer_message}
                                subjectLine={item.subject_line}
                                customerEmail={item.customer_email}
                              />
                            </div>
                          )}

                          {/* Internal Working Notes (highlighted amber, matching chat style) */}
                          {item.internal_notes && item.internal_notes.length > 0 && (
                            <InternalNotesBlock notes={item.internal_notes} />
                          )}
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
      <Pager page={paging.page} pages={paging.pages} onPage={paging.setPage} />
    </div>
  );
}

export default function TLEmailQualityPage() {
  const [agents, setAgents] = useState<AgentBreakdown[]>([]);
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
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
        if (Array.isArray(data.availableAgents) && data.availableAgents.length > 0) {
          setAvailableAgents(data.availableAgents);
        } else {
          setAvailableAgents((data.agentBreakdown || []).map((a: any) => a.agent_name));
        }
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

  const paging = usePaging(replies, `${selectedAgent}|${period.period}|${period.customFrom}|${period.customTo}`);

  return (
    <div>
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Quality Emails
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2)', margin: '4px 0 0' }}>
          Team-level email performance and individual member results
        </p>
      </div>

      {/* ── Tabs (left) + period filter (right), same slot as the chat/call pages ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
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
      <PeriodFilter value={period} onChange={setPeriod} />
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
        {/* Filter bar, same slots as the chat tables: filters left, count + rows per page right */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--qa-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
            style={{ height: 32, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: selectedAgent ? 'var(--qa-text)' : 'var(--qa-text-2)', fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}
          >
            <option value="">All Agents</option>
            {(availableAgents.length > 0 ? availableAgents : agents.map(a => a.agent_name)).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {selectedAgent && (
            <button onClick={() => setSelectedAgent('')} style={{ height: 32, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
              Reset Filters
            </button>
          )}
          <div style={{ flex: 1 }} />
          <ShowingCount shown={paging.pageItems.length} total={paging.total} loading={loading} pageSize={paging.pageSize} onPageSize={paging.setPageSize} />
        </div>

        {/* Replies Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 135 }} />
              <col style={{ width: 160 }} />
              <col />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Ticket ID</th>
                <th style={th}>Date & Time</th>
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
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                    Loading team email replies…
                  </td>
                </tr>
              ) : paging.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                    No replies matching selected filters
                  </td>
                </tr>
              ) : (
                paging.pageItems.map((reply) => {
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
                          {reply.customer_email && (
                            <div
                              title={`User Email: ${reply.customer_email}`}
                              style={{
                                fontSize: 11,
                                color: 'var(--qa-text-3)',
                                fontFamily: SANS,
                                marginTop: 3,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: 150,
                              }}
                            >
                              {reply.customer_email}
                            </div>
                          )}
                        </td>
                        {(() => {
                          const dt = formatEmailDateTime(reply.sent_at);
                          return (
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              <div style={{ fontSize: 13, color: 'var(--qa-text)' }}>{dt.date}</div>
                              {dt.time && (
                                <div style={{ fontSize: 11, color: 'var(--qa-text-3)', marginTop: 2, fontFamily: MONO }}>
                                  {dt.time}
                                </div>
                              )}
                            </td>
                          );
                        })()}
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
                          <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
                            <div style={{
                              background: 'var(--qa-gray-50)',
                              borderTop: '1px solid var(--qa-border-sub)',
                              padding: '20px 24px',
                              display: 'grid',
                              gridTemplateColumns: '1fr 1.2fr',
                              gap: 24,
                            }}>
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
                                  <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--qa-border-sub)' }}>
                                    <ScoreRing score={reply.effective_score ?? reply.quality_score} />
                                    <div>
                                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>{reply.agent_name || 'Unassigned'}</div>
                                      <div style={{ fontSize: 12, color: 'var(--qa-text-3)', marginTop: 4 }}>
                                        <span style={{ fontFamily: MONO }}>{reply.chat_id ?? reply.ticket_id}</span>
                                        {' · '}
                                        {new Date(reply.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                      </div>
                                    </div>
                                  </div>
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
                                    return (
                                      <ParamScoreRow
                                        key={def.key}
                                        name={def.name}
                                        description={def.description}
                                        value={val}
                                        allowNA={def.allowNA}
                                        weight={def.defaultWeight}
                                        reason={scores?.__reasoning?.[def.key]}
                                        last={idx === DEFAULT_EMAIL_PARAMETERS.length - 1}
                                      />
                                    );
                                  })}
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div>
                                  {/* 1. Customer Core Query (Separate & prominent) */}
                                  <CustomerCoreQueryCard
                                    threadSummary={reply.thread_summary}
                                    customerMessage={reply.customer_message}
                                    subjectLine={reply.subject_line}
                                    customerEmail={reply.customer_email}
                                    parameterScores={reply.parameter_scores}
                                  />

                                  {/* 2. Customer Inbound Email Thread */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                          Customer Inbound Email Thread
                                        </div>
                                        {reply.customer_email && (
                                          <span
                                            style={{
                                              fontSize: 11,
                                              color: '#1d4ed8',
                                              background: '#eff6ff',
                                              border: '1px solid #bfdbfe',
                                              padding: '1px 7px',
                                              borderRadius: 4,
                                              fontWeight: 500,
                                              fontFamily: MONO,
                                            }}
                                            title={`User Email: ${reply.customer_email}`}
                                          >
                                            {reply.customer_email}
                                          </span>
                                        )}
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
                                        currentMessageId={reply.message_id}
                                        onClose={() => setHistoryOpen(prev => ({ ...prev, [reply.message_id]: false }))}
                                      />
                                    )}

                                    <CustomerEmailThreadCard
                                      customerMessage={reply.customer_message}
                                      subjectLine={reply.subject_line}
                                      customerEmail={reply.customer_email}
                                    />
                                  </div>

                                  {/* Internal Working Notes (highlighted amber, matching chat style) */}
                                  {reply.internal_notes && reply.internal_notes.length > 0 && (
                                    <InternalNotesBlock notes={reply.internal_notes} />
                                  )}
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
        <Pager page={paging.page} pages={paging.pages} onPage={paging.setPage} />
      </div>
      </>
      )}
    </div>
  );
}
