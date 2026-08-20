'use client';

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import type { CSSProperties } from 'react';
import CallEvalPanel from '../quality/CallEvalPanel';
import type { TLDisputeRow } from '@/app/api/cx/tl/disputes/route';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const TH_BASE: CSSProperties = {
  height: 40,
  background: 'var(--qa-gray-50, #FAFAFB)',
  borderBottom: '1px solid var(--qa-border, #E4E4E7)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--qa-text-2, #6B6B6B)',
  fontWeight: 500,
  padding: '0 16px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const TD_BASE: CSSProperties = {
  height: 52,
  padding: '0 16px',
  borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
  fontSize: 14,
  color: 'var(--qa-text, #111111)',
  verticalAlign: 'middle',
};

const TD_MONO: CSSProperties = {
  ...TD_BASE,
  fontFamily: MONO,
  fontSize: 13,
  color: 'var(--qa-text-2, #6B6B6B)',
};

const TD_NUM: CSSProperties = {
  ...TD_BASE,
  textAlign: 'right',
  fontFamily: MONO,
  fontSize: 13,
};

function IQSBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13 }}>—</span>;
  const bg = score >= 85 ? '#f0fdf4' : score >= 70 ? '#fefce8' : '#fef2f2';
  const color = score >= 85 ? '#166534' : score >= 70 ? '#854d0e' : '#991b1b';
  const border = score >= 85 ? '#bbf7d0' : score >= 70 ? '#fef08a' : '#fecaca';
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
        fontWeight: 600,
        fontFamily: MONO,
        background: bg,
        color: color,
        border: `1px solid ${border}`,
      }}
    >
      {score}
    </span>
  );
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
        background: active ? 'rgba(255,255,255,0.2)' : 'var(--qa-gray-100, #F4F4F5)',
        color: active ? '#fff' : 'var(--qa-text-2, #6B6B6B)',
      }}
    >
      {count}
    </span>
  );
}

function fmtDuration(secs: number | null) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const CALL_PARAM_NAMES: Record<string, string> = {
  P1: 'Technically / Legally Correct (P1)',
  P2: 'All Questions Addressed (P2)',
  P3: 'Expectation Setting & Follow-up Specificity (P3)',
  P5: 'Call Opening (P5)',
  P6: 'Call Closing (P6)',
  P7: 'Pre-check, No Repeat Asks (P7)',
  P8: 'Simplifying & Jargon Handling (P8)',
  P9: 'Active Listening & Interruptions (P9)',
  P10: 'Fillers & Dead Air (P10)',
  P11: 'Energy, Warmth, & Pace (P11)',
};

interface CallScoreEntry {
  callId: string;
  chatId: string | null;
  agentName: string;
  date: string;
  calledAt: string;
  disposition: string;
  subDisposition?: string;
  durationSeconds: number | null;
  language: string;
  interruptionCount: number;
  deadAirCount: number;
  iqs: number | null;
  scores: Record<string, string>;
  reasoning: Record<string, string>;
  failedParams: string[];
  gates?: any;
  verdict?: string | null;
  rawParameters?: any;
}

export default function TLQualityCallsPage() {
  const [activeTab, setActiveTab] = useState<'evaluated' | 'disputes' | 'reviewed'>('evaluated');

  // Evaluated Calls State
  const [entries, setEntries] = useState<CallScoreEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Filters State
  const [agentFilter, setAgentFilter] = useState('');
  const [agentsList, setAgentsList] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');
  const [page, setPage] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);

  // Disputes State
  const [pendingDisputes, setPendingDisputes] = useState<TLDisputeRow[]>([]);
  const [reviewedDisputes, setReviewedDisputes] = useState<TLDisputeRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingReviewed, setLoadingReviewed] = useState(true);
  const [expandedDisputeId, setExpandedDisputeId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Thread comments state
  const [commentsMap, setCommentsMap] = useState<Record<string, any[]>>({});
  const [newCommentText, setNewCommentText] = useState<Record<string, string>>({});
  const [postingComment, setPostingComment] = useState(false);

  // Fetch Evaluated Calls
  const fetchEvaluatedCalls = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const p = new URLSearchParams({ page: String(page) });
      if (agentFilter) p.set('agent', agentFilter);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      if (iqsMin) p.set('minScore', iqsMin);
      if (iqsMax) p.set('maxScore', iqsMax);

      const res = await fetch(`/api/call-quality/scores?${p}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      const rows: CallScoreEntry[] = Array.isArray(data.entries) ? data.entries : [];
      setEntries(rows);
      setTotalEntries(data.total ?? rows.length);

      // Collect available agents
      if (Array.isArray(data.agents) && data.agents.length > 0) {
        setAgentsList(data.agents);
      } else {
        const agentNamesSet = new Set<string>();
        rows.forEach(r => { if (r.agentName) agentNamesSet.add(r.agentName); });
        setAgentsList(prev => [...new Set([...prev, ...Array.from(agentNamesSet)])]);
      }
    } catch {
      setEntries([]);
      setTotalEntries(0);
    } finally {
      setLoadingEntries(false);
    }
  }, [agentFilter, dateFrom, dateTo, iqsMin, iqsMax, page]);

  useEffect(() => {
    fetchEvaluatedCalls();
  }, [fetchEvaluatedCalls]);

  // Fetch Disputes
  const fetchDisputes = useCallback(async () => {
    setLoadingPending(true);
    setLoadingReviewed(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/cx/tl/disputes?status=pending'),
        fetch('/api/cx/tl/disputes?status=resolved'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);

      const pAll: TLDisputeRow[] = Array.isArray(pData.disputes) ? pData.disputes : [];
      const rAll: TLDisputeRow[] = Array.isArray(rData.disputes) ? rData.disputes : [];

      const isCallDispute = (d: TLDisputeRow) => Boolean(d.callId || d.callIqsScore != null || d.challengedParams?.some(p => p.param.startsWith('P')));

      setPendingDisputes(pAll.filter(isCallDispute));
      setReviewedDisputes(rAll.filter(isCallDispute));
    } catch {
      setPendingDisputes([]);
      setReviewedDisputes([]);
    } finally {
      setLoadingPending(false);
      setLoadingReviewed(false);
    }
  }, []);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const handleForwardToQA = async (flagId: string) => {
    setActioningId(flagId);
    try {
      const res = await fetch('/api/cx/tl/disputes/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId }),
      });
      if (res.ok) {
        alert('Dispute forwarded to QA successfully!');
        await fetchDisputes();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to forward dispute');
      }
    } catch (e: any) {
      alert(`Error forwarding dispute: ${e.message}`);
    } finally {
      setActioningId(null);
    }
  };

  const fetchFlagThread = async (flagId: string) => {
    try {
      const res = await fetch(`/api/quality/flag-thread?flagId=${flagId}`);
      if (!res.ok) return;
      const data = await res.json();
      setCommentsMap(prev => ({ ...prev, [flagId]: data.comments || [] }));
    } catch {
      // ignore
    }
  };

  const handlePostComment = async (flagId: string) => {
    const content = (newCommentText[flagId] || '').trim();
    if (!content) return;

    setPostingComment(true);
    try {
      const res = await fetch('/api/quality/flag-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, content }),
      });
      if (res.ok) {
        setNewCommentText(prev => ({ ...prev, [flagId]: '' }));
        await fetchFlagThread(flagId);
      } else {
        alert('Failed to post comment');
      }
    } catch (e: any) {
      alert(`Error posting comment: ${e.message}`);
    } finally {
      setPostingComment(false);
    }
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    height: 36,
    padding: '0 16px',
    border: 'none',
    borderRadius: 8,
    background: active ? 'var(--qa-gray-700, #27272A)' : 'transparent',
    color: active ? '#fff' : 'var(--qa-text-2, #6B6B6B)',
    fontSize: 13,
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  });

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--qa-text, #111111)', margin: '0 0 6px 0' }}>
          Team Lead — Quality Calls
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)', margin: 0 }}>
          View team members' call evaluations, manage raised call disputes, post thread notes, and forward disputes to QA.
        </p>
      </div>

      {/* Tabs Bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        <button style={tabStyle(activeTab === 'evaluated')} onClick={() => setActiveTab('evaluated')}>
          Evaluated Calls
          <CountBadge count={totalEntries} active={activeTab === 'evaluated'} />
        </button>
        <button style={tabStyle(activeTab === 'disputes')} onClick={() => setActiveTab('disputes')}>
          Disputes Raised
          <CountBadge count={pendingDisputes.length} active={activeTab === 'disputes'} />
        </button>
        <button style={tabStyle(activeTab === 'reviewed')} onClick={() => setActiveTab('reviewed')}>
          Reviewed Disputes
          <CountBadge count={reviewedDisputes.length} active={activeTab === 'reviewed'} />
        </button>
      </div>

      {/* ── TAB 1: EVALUATED CALLS ────────────────────────────────────────────── */}
      {activeTab === 'evaluated' && (
        <div>
          {/* Filters Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <select
              value={agentFilter}
              onChange={e => { setAgentFilter(e.target.value); setPage(0); }}
              style={{
                height: 36,
                padding: '0 12px',
                border: '1px solid var(--qa-border, #E4E4E7)',
                borderRadius: 8,
                fontSize: 13,
                outline: 'none',
                minWidth: 160,
                background: '#fff',
              }}
            >
              <option value="">All Team Agents</option>
              {agentsList.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(0); }}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, fontSize: 13, background: '#fff' }}
              placeholder="From Date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(0); }}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, fontSize: 13, background: '#fff' }}
              placeholder="To Date"
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                placeholder="Min IQS"
                value={iqsMin}
                onChange={e => { setIqsMin(e.target.value); setPage(0); }}
                style={{ width: 80, height: 36, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, fontSize: 13 }}
              />
              <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>to</span>
              <input
                type="number"
                placeholder="Max IQS"
                value={iqsMax}
                onChange={e => { setIqsMax(e.target.value); setPage(0); }}
                style={{ width: 80, height: 36, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, fontSize: 13 }}
              />
            </div>

            {(agentFilter || dateFrom || dateTo || iqsMin || iqsMax) && (
              <button
                onClick={() => {
                  setAgentFilter('');
                  setDateFrom('');
                  setDateTo('');
                  setIqsMin('');
                  setIqsMax('');
                  setPage(0);
                }}
                style={{
                  height: 36,
                  padding: '0 12px',
                  border: '1px solid var(--qa-border)',
                  borderRadius: 8,
                  background: '#fff',
                  color: '#ef4444',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Table */}
          <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th style={TH_BASE}>Call ID</th>
                  <th style={TH_BASE}>Agent Name</th>
                  <th style={TH_BASE}>Date / Time</th>
                  <th style={TH_BASE}>Disposition</th>
                  <th style={TH_BASE}>Duration</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS Score</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingEntries ? (
                  <tr>
                    <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading team evaluated calls…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      No evaluated calls found for your team.
                    </td>
                  </tr>
                ) : (
                  entries.map(call => {
                    const isExpanded = expandedCallId === call.callId;
                    return (
                      <Fragment key={call.callId}>
                        <tr
                          onClick={() => setExpandedCallId(isExpanded ? null : call.callId)}
                          style={{
                            background: isExpanded ? 'var(--qa-gray-50, #FAFAFB)' : undefined,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <td style={TD_MONO}>{call.callId}</td>
                          <td style={{ ...TD_BASE, fontWeight: 500 }}>{call.agentName}</td>
                          <td style={TD_BASE}>
                            {call.calledAt ? new Date(call.calledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : call.date}
                          </td>
                          <td style={TD_BASE}>{call.disposition || '—'}</td>
                          <td style={TD_MONO}>{fmtDuration(call.durationSeconds)}</td>
                          <td style={TD_NUM}>
                            <IQSBadge score={call.iqs} />
                          </td>
                          <td style={{ ...TD_BASE, textAlign: 'right' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedCallId(isExpanded ? null : call.callId);
                              }}
                              style={{
                                background: 'none', border: 0, padding: 0,
                                fontSize: 13, fontWeight: 500, color: 'var(--qa-text)', cursor: 'pointer',
                              }}
                            >
                              {isExpanded ? 'Hide' : 'View Details'}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <CallEvalPanel
                            callId={call.callId}
                            chatId={call.chatId}
                            agentName={call.agentName}
                            iqsScore={call.iqs ?? 0}
                            calledAt={call.calledAt}
                            disposition={call.disposition}
                            gates={call.gates}
                            iqsScores={call.rawParameters || { scores: call.scores, evidence: call.reasoning }}
                            mode="view"
                            onDone={() => fetchEvaluatedCalls()}
                            onClose={() => setExpandedCallId(null)}
                            colSpan={7}
                          />
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 2: DISPUTES RAISED (PENDING TL REVIEW) ───────────────────────── */}
      {activeTab === 'disputes' && (
        <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={TH_BASE}>Call / Chat ID</th>
                <th style={TH_BASE}>Agent Name</th>
                <th style={TH_BASE}>Raised By</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                <th style={TH_BASE}>Disposition</th>
                <th style={TH_BASE}>Date Raised</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingPending ? (
                <tr>
                  <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    Loading raised call disputes…
                  </td>
                </tr>
              ) : pendingDisputes.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    No pending call disputes raised for your team.
                  </td>
                </tr>
              ) : (
                pendingDisputes.map(dispute => {
                  const isOpen = expandedDisputeId === dispute.flagId;
                  const comments = commentsMap[dispute.flagId] || [];

                  return (
                    <Fragment key={dispute.flagId}>
                      <tr
                        onClick={() => {
                          setExpandedDisputeId(isOpen ? null : dispute.flagId);
                          if (!isOpen) fetchFlagThread(dispute.flagId);
                        }}
                        style={{ cursor: 'pointer', background: isOpen ? 'var(--qa-gray-50)' : undefined }}
                      >
                        <td style={TD_MONO}>{dispute.callId || dispute.chatId}</td>
                        <td style={{ ...TD_BASE, fontWeight: 500 }}>{dispute.agentName}</td>
                        <td style={TD_BASE}>{dispute.raisedByName} ({dispute.raisedBy})</td>
                        <td style={TD_NUM}>
                          <IQSBadge score={dispute.callIqsScore ?? dispute.iqsScore} />
                        </td>
                        <td style={TD_BASE}>{dispute.disposition || '—'}</td>
                        <td style={TD_BASE}>{new Date(dispute.raisedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td style={{ ...TD_BASE, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handleForwardToQA(dispute.flagId)}
                            disabled={actioningId === dispute.flagId}
                            style={{
                              padding: '6px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                              background: '#0284c7',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            {actioningId === dispute.flagId ? 'Forwarding…' : 'Forward to QA'}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ padding: 20, background: '#f8fafc', borderBottom: '1px solid var(--qa-border)' }}>
                            <div style={{ maxWidth: 800 }}>
                              <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>Dispute Details</h4>
                              <p style={{ fontSize: 13, color: 'var(--qa-text-2)', marginBottom: 12 }}>
                                <b>Agent Note:</b> {dispute.agentNote || 'No note provided'}
                              </p>

                              {dispute.challengedParams?.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <b style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>Challenged Parameters:</b>
                                  <ul style={{ margin: '6px 0 0 0', paddingLeft: 20, fontSize: 13 }}>
                                    {dispute.challengedParams.map((cp, idx) => (
                                      <li key={idx}>
                                        <b>{CALL_PARAM_NAMES[cp.param] || cp.param}:</b> {cp.note || 'No specific note'}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Thread Comments */}
                              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 12 }}>
                                <h5 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600 }}>Discussion Thread</h5>
                                {comments.length === 0 ? (
                                  <p style={{ fontSize: 12, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>No comments yet.</p>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                                    {comments.map(c => (
                                      <div key={c.id} style={{ background: '#fff', border: '1px solid #e2e8f0', padding: 8, borderRadius: 6, fontSize: 12 }}>
                                        <b>{c.authorName} ({c.role}):</b> {c.content}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div style={{ display: 'flex', gap: 8 }}>
                                  <input
                                    type="text"
                                    placeholder="Add comment to dispute thread…"
                                    value={newCommentText[dispute.flagId] || ''}
                                    onChange={e => setNewCommentText({ ...newCommentText, [dispute.flagId]: e.target.value })}
                                    style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6 }}
                                  />
                                  <button
                                    onClick={() => handlePostComment(dispute.flagId)}
                                    disabled={postingComment}
                                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--qa-gray-700)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                                  >
                                    Send
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 3: REVIEWED DISPUTES ────────────────────────────────────────── */}
      {activeTab === 'reviewed' && (
        <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={TH_BASE}>Call / Chat ID</th>
                <th style={TH_BASE}>Agent Name</th>
                <th style={TH_BASE}>Raised By</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                <th style={TH_BASE}>Status</th>
                <th style={TH_BASE}>Date Raised</th>
                <th style={TH_BASE}>Review Note</th>
              </tr>
            </thead>
            <tbody>
              {loadingReviewed ? (
                <tr>
                  <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    Loading reviewed call disputes…
                  </td>
                </tr>
              ) : reviewedDisputes.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    No reviewed call disputes found for your team.
                  </td>
                </tr>
              ) : (
                reviewedDisputes.map(dispute => (
                  <tr key={dispute.flagId}>
                    <td style={TD_MONO}>{dispute.callId || dispute.chatId}</td>
                    <td style={{ ...TD_BASE, fontWeight: 500 }}>{dispute.agentName}</td>
                    <td style={TD_BASE}>{dispute.raisedByName} ({dispute.raisedBy})</td>
                    <td style={TD_NUM}>
                      <IQSBadge score={dispute.callIqsScore ?? dispute.iqsScore} />
                    </td>
                    <td style={TD_BASE}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                        {dispute.status}
                      </span>
                    </td>
                    <td style={TD_BASE}>{new Date(dispute.raisedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td style={TD_BASE}>{dispute.reviewNote || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
