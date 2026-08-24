'use client';

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import type { CSSProperties } from 'react';
import CallEvalPanel from '../quality/CallEvalPanel';
import { DisputeThread } from '../quality/DisputeThread';
import type { TLDisputeRow } from '@/app/api/cx/tl/disputes/route';
import { DisputeStatusPill, getDisputeOutcomeKey } from './QualityChatsPage';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

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
  rawParameters?: any;
}

export default function TLQualityCallsPage() {
  const [activeTab, setActiveTab] = useState<'evaluated' | 'disputes' | 'reviewed'>('evaluated');

  // Evaluated Calls State
  const [entries, setEntries] = useState<CallScoreEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Filters State for Evaluated Calls
  const [agentFilter, setAgentFilter] = useState('');
  const [agentsList, setAgentsList] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [totalEntries, setTotalEntries] = useState(0);

  // Disputes State
  const [pendingDisputes, setPendingDisputes] = useState<TLDisputeRow[]>([]);
  const [reviewedDisputes, setReviewedDisputes] = useState<TLDisputeRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingReviewed, setLoadingReviewed] = useState(true);
  const [expandedDisputeId, setExpandedDisputeId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filter state for Disputes
  const [pendingAgentFilter, setPendingAgentFilter] = useState('');
  const [pendingOutcomeFilter, setPendingOutcomeFilter] = useState('');
  const [pendingFromFilter, setPendingFromFilter] = useState('');
  const [pendingToFilter, setPendingToFilter] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingLimit, setPendingLimit] = useState(20);

  const [reviewedAgentFilter, setReviewedAgentFilter] = useState('');
  const [reviewedOutcomeFilter, setReviewedOutcomeFilter] = useState('');
  const [reviewedFromFilter, setReviewedFromFilter] = useState('');
  const [reviewedToFilter, setReviewedToFilter] = useState('');
  const [reviewedPage, setReviewedPage] = useState(1);
  const [reviewedLimit, setReviewedLimit] = useState(20);

  const [openPageDrop, setOpenPageDrop] = useState<'tab1' | 'tab2' | 'tab3' | null>(null);

  useEffect(() => {
    const handleOutside = () => setOpenPageDrop(null);
    window.addEventListener('click', handleOutside);
    return () => window.removeEventListener('click', handleOutside);
  }, []);

  // Fetch Evaluated Calls
  const fetchEvaluatedCalls = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: String(limit) });
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
  }, [agentFilter, dateFrom, dateTo, iqsMin, iqsMax, page, limit]);

  useEffect(() => {
    fetchEvaluatedCalls();
  }, [fetchEvaluatedCalls]);

  // Fetch Disputes
  const fetchDisputes = useCallback(async () => {
    setLoadingPending(true);
    setLoadingReviewed(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/cx/tl/disputes?status=pending&type=calls'),
        fetch('/api/cx/tl/disputes?status=resolved&type=calls'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);

      const pAll: TLDisputeRow[] = Array.isArray(pData.disputes) ? pData.disputes : [];
      const rAll: TLDisputeRow[] = Array.isArray(rData.disputes) ? rData.disputes : [];

      const isCallDispute = (d: TLDisputeRow) => Boolean(d.callId);

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
    setActionError(null);
    try {
      const res = await fetch('/api/cx/tl/disputes/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId }),
      });
      if (res.ok) {
        await fetchDisputes();
      } else {
        const d = await res.json();
        setActionError(d.error || 'Failed to forward dispute');
      }
    } catch (e: any) {
      setActionError(`Error forwarding dispute: ${e.message}`);
    } finally {
      setActioningId(null);
    }
  };

  const handleResolveAtTLLevel = async (flagId: string) => {
    const note = prompt('Enter a note explaining why this call dispute was resolved at TL level:');
    if (note === null) return;

    setActioningId(flagId);
    setActionError(null);
    try {
      const res = await fetch('/api/cx/tl/disputes/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, reviewNote: note || 'Resolved call dispute at TL level' }),
      });
      if (res.ok) {
        await fetchDisputes();
      } else {
        const d = await res.json();
        setActionError(d.error || 'Failed to resolve dispute');
      }
    } catch (e: any) {
      setActionError(`Error resolving dispute: ${e.message}`);
    } finally {
      setActioningId(null);
    }
  };

  // Filter pending disputes
  const filteredPendingDisputes = pendingDisputes.filter(d => {
    if (pendingAgentFilter && d.agentName !== pendingAgentFilter) return false;
    if (pendingOutcomeFilter && getDisputeOutcomeKey(d) !== pendingOutcomeFilter) return false;
    if (pendingFromFilter) {
      const dDate = d.raisedAt ? d.raisedAt.substring(0, 10) : '';
      if (dDate < pendingFromFilter) return false;
    }
    if (pendingToFilter) {
      const dDate = d.raisedAt ? d.raisedAt.substring(0, 10) : '';
      if (dDate > pendingToFilter) return false;
    }
    return true;
  });

  // Filter reviewed disputes
  const filteredReviewedDisputes = reviewedDisputes.filter(d => {
    if (reviewedAgentFilter && d.agentName !== reviewedAgentFilter) return false;
    if (reviewedOutcomeFilter && getDisputeOutcomeKey(d) !== reviewedOutcomeFilter) return false;
    if (reviewedFromFilter) {
      const dDate = d.raisedAt ? d.raisedAt.substring(0, 10) : '';
      if (dDate < reviewedFromFilter) return false;
    }
    if (reviewedToFilter) {
      const dDate = d.raisedAt ? d.raisedAt.substring(0, 10) : '';
      if (dDate > reviewedToFilter) return false;
    }
    return true;
  });

  const pagedPending = filteredPendingDisputes.slice((pendingPage - 1) * pendingLimit, pendingPage * pendingLimit);
  const totalPendingPages = Math.max(1, Math.ceil(filteredPendingDisputes.length / pendingLimit));

  const pagedReviewed = filteredReviewedDisputes.slice((reviewedPage - 1) * reviewedLimit, reviewedPage * reviewedLimit);
  const totalReviewedPages = Math.max(1, Math.ceil(filteredReviewedDisputes.length / reviewedLimit));

  const totalEvaluatedPages = Math.max(1, Math.ceil(totalEntries / limit));

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

  const chipInputStyle: CSSProperties = {
    height: 32,
    padding: '0 10px',
    border: '1px solid var(--qa-border, #E4E4E7)',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: SANS,
    background: 'var(--qa-card, #FFFFFF)',
    color: 'var(--qa-text, #111111)',
    outline: 'none',
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto', fontFamily: SANS }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--qa-text, #111111)', margin: '0 0 6px 0' }}>
          Team Lead — Quality Calls
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)', margin: 0 }}>
          View team members' call evaluations, manage raised call disputes, post thread comments, resolve disputes, or forward to QA.
        </p>
      </div>

      {actionError && (
        <div style={{ padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
          {actionError}
        </div>
      )}

      {/* Tabs Bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        <button style={tabStyle(activeTab === 'evaluated')} onClick={() => setActiveTab('evaluated')}>
          Evaluated Calls
          <CountBadge count={totalEntries} active={activeTab === 'evaluated'} />
        </button>
        <button style={tabStyle(activeTab === 'disputes')} onClick={() => setActiveTab('disputes')}>
          Disputes Raised
          <CountBadge count={filteredPendingDisputes.length} active={activeTab === 'disputes'} />
        </button>
        <button style={tabStyle(activeTab === 'reviewed')} onClick={() => setActiveTab('reviewed')}>
          Reviewed Disputes
          <CountBadge count={filteredReviewedDisputes.length} active={activeTab === 'reviewed'} />
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
              style={{ ...chipInputStyle, minWidth: 160 }}
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
              style={chipInputStyle}
              title="From Date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(0); }}
              style={chipInputStyle}
              title="To Date"
            />

            <input
              type="number"
              placeholder="Min IQS"
              value={iqsMin}
              onChange={e => { setIqsMin(e.target.value); setPage(0); }}
              style={{ ...chipInputStyle, width: 80 }}
            />
            <input
              type="number"
              placeholder="Max IQS"
              value={iqsMax}
              onChange={e => { setIqsMax(e.target.value); setPage(0); }}
              style={{ ...chipInputStyle, width: 80 }}
            />

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
                style={{ height: 32, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 8, background: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                Clear Filters
              </button>
            )}

            {/* Rows per page */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
                {totalEntries === 0 ? '0 calls' : `Showing ${page * limit + 1}–${Math.min((page + 1) * limit, totalEntries)} of ${totalEntries}`}
              </span>
              <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenPageDrop(openPageDrop === 'tab1' ? null : 'tab1')}
                  style={{ height: 28, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}
                >
                  {limit} / page ▾
                </button>
                {openPageDrop === 'tab1' && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50, background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    {[20, 50, 100].map(n => (
                      <div
                        key={n}
                        onClick={() => { setLimit(n); setPage(0); setOpenPageDrop(null); }}
                        style={{ padding: '6px 16px', fontSize: 12, cursor: 'pointer', background: limit === n ? '#f4f4f5' : '#fff' }}
                      >
                        {n} rows
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
                  <th style={TH_BASE}>Linked Chat</th>
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
                          <td style={TD_BASE} onClick={e => e.stopPropagation()}>
                            {call.chatId ? (
                              <a
                                href={`https://app.robylon.ai/unified-inbox/share/${call.chatId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '3px 8px',
                                  fontSize: 12,
                                  fontWeight: 500,
                                  borderRadius: 6,
                                  border: '1px solid var(--qa-border, #E4E4E7)',
                                  background: '#fff',
                                  color: '#2563eb',
                                  textDecoration: 'none',
                                  whiteSpace: 'nowrap',
                                }}
                                title={`Open chat ${call.chatId} in Robylon`}
                              >
                                Show chat ↗
                              </a>
                            ) : (
                              <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13 }}>—</span>
                            )}
                          </td>
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
                            allowRaiseDispute={true}
                            onDisputeRaised={() => fetchEvaluatedCalls()}
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

            {/* Pagination footer */}
            {totalEvaluatedPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--qa-border)' }}>
                <span style={{ fontSize: 13, color: 'var(--qa-text-2)' }}>Page {page + 1} of {totalEvaluatedPages}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    style={{ height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalEvaluatedPages - 1, p + 1))}
                    disabled={page >= totalEvaluatedPages - 1}
                    style={{ height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: page >= totalEvaluatedPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalEvaluatedPages - 1 ? 0.5 : 1 }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: DISPUTES RAISED (PENDING TL ACTION) ───────────────────────── */}
      {activeTab === 'disputes' && (
        <div>
          {/* Filters Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <select
              value={pendingAgentFilter}
              onChange={e => { setPendingAgentFilter(e.target.value); setPendingPage(1); }}
              style={{ ...chipInputStyle, minWidth: 140 }}
            >
              <option value="">All Agents</option>
              {Array.from(new Set(pendingDisputes.map(d => d.agentName).filter(Boolean))).sort().map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <select
              value={pendingOutcomeFilter}
              onChange={e => { setPendingOutcomeFilter(e.target.value); setPendingPage(1); }}
              style={{ ...chipInputStyle, minWidth: 140 }}
            >
              <option value="">All Statuses</option>
              <option value="raised_ir">Dispute raised by IR</option>
              <option value="raised_tl">Dispute raised by TL</option>
            </select>

            <input
              type="date"
              value={pendingFromFilter}
              onChange={e => { setPendingFromFilter(e.target.value); setPendingPage(1); }}
              style={chipInputStyle}
              title="From Date"
            />
            <input
              type="date"
              value={pendingToFilter}
              onChange={e => { setPendingToFilter(e.target.value); setPendingPage(1); }}
              style={chipInputStyle}
              title="To Date"
            />

            {(pendingAgentFilter || pendingOutcomeFilter || pendingFromFilter || pendingToFilter) && (
              <button
                onClick={() => {
                  setPendingAgentFilter('');
                  setPendingOutcomeFilter('');
                  setPendingFromFilter('');
                  setPendingToFilter('');
                  setPendingPage(1);
                }}
                style={{ height: 32, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 8, background: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                Clear Filters
              </button>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
                {filteredPendingDisputes.length === 0 ? '0 disputes' : `Showing ${(pendingPage - 1) * pendingLimit + 1}–${Math.min(pendingPage * pendingLimit, filteredPendingDisputes.length)} of ${filteredPendingDisputes.length}`}
              </span>
              <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenPageDrop(openPageDrop === 'tab2' ? null : 'tab2')}
                  style={{ height: 28, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}
                >
                  {pendingLimit} / page ▾
                </button>
                {openPageDrop === 'tab2' && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50, background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    {[20, 50, 100].map(n => (
                      <div
                        key={n}
                        onClick={() => { setPendingLimit(n); setPendingPage(1); setOpenPageDrop(null); }}
                        style={{ padding: '6px 16px', fontSize: 12, cursor: 'pointer', background: pendingLimit === n ? '#f4f4f5' : '#fff' }}
                      >
                        {n} rows
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th style={TH_BASE}>Call ID</th>
                  <th style={TH_BASE}>Agent Name</th>
                  <th style={TH_BASE}>Raised By</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                  <th style={TH_BASE}>Disposition</th>
                  <th style={TH_BASE}>Linked Chat</th>
                  <th style={TH_BASE}>Status</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingPending ? (
                  <tr>
                    <td colSpan={8} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading raised call disputes…
                    </td>
                  </tr>
                ) : filteredPendingDisputes.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      No pending call disputes raised for your team.
                    </td>
                  </tr>
                ) : (
                  pagedPending.map(dispute => {
                    const isOpen = expandedDisputeId === dispute.flagId;
                    const callKey = dispute.callId || dispute.chatId;

                    return (
                      <Fragment key={dispute.flagId}>
                        <tr
                          onClick={() => setExpandedDisputeId(isOpen ? null : dispute.flagId)}
                          style={{ cursor: 'pointer', background: isOpen ? 'var(--qa-gray-50)' : undefined }}
                        >
                          <td style={TD_MONO}>{callKey}</td>
                          <td style={{ ...TD_BASE, fontWeight: 500 }}>{dispute.agentName}</td>
                          <td style={TD_BASE}>{dispute.raisedByName} ({dispute.raisedBy})</td>
                          <td style={TD_NUM}>
                            <IQSBadge score={dispute.callIqsScore ?? dispute.iqsScore} />
                          </td>
                          <td style={TD_BASE}>{dispute.disposition || '—'}</td>
                          <td style={TD_BASE} onClick={e => e.stopPropagation()}>
                            {dispute.chatId ? (
                              <a
                                href={`https://app.robylon.ai/unified-inbox/share/${dispute.chatId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '3px 8px',
                                  fontSize: 12,
                                  fontWeight: 500,
                                  borderRadius: 6,
                                  border: '1px solid var(--qa-border, #E4E4E7)',
                                  background: '#fff',
                                  color: '#2563eb',
                                  textDecoration: 'none',
                                  whiteSpace: 'nowrap',
                                }}
                                title={`Open chat ${dispute.chatId} in Robylon`}
                              >
                                Show chat ↗
                              </a>
                            ) : (
                              <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13 }}>—</span>
                            )}
                          </td>
                          <td style={TD_BASE}>
                            <DisputeStatusPill
                              status={dispute.status}
                              raisedByRole={dispute.raisedByRole || (dispute as any).raisedBy}
                              reviewNote={dispute.reviewNote}
                              parameters={dispute.parameters}
                            />
                          </td>
                          <td style={{ ...TD_BASE, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                onClick={() => handleForwardToQA(dispute.flagId)}
                                disabled={actioningId === dispute.flagId}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: '#0284c7',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 6,
                                  cursor: actioningId === dispute.flagId ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {actioningId === dispute.flagId ? '…' : 'Forward to QA'}
                              </button>
                              <button
                                onClick={() => handleResolveAtTLLevel(dispute.flagId)}
                                disabled={actioningId === dispute.flagId}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: '#166534',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 6,
                                  cursor: actioningId === dispute.flagId ? 'not-allowed' : 'pointer',
                                }}
                              >
                                Resolve
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isOpen && (
                          <CallEvalPanel
                            callId={callKey}
                            chatId={dispute.chatId}
                            agentName={dispute.agentName}
                            iqsScore={dispute.callIqsScore ?? dispute.iqsScore ?? 0}
                            calledAt={dispute.closedAt || dispute.raisedAt}
                            disposition={dispute.disposition}
                            gates={dispute.gates || dispute.parameters?.gates}
                            iqsScores={dispute.parameters || {}}
                            mode="view"
                            dispute={dispute}
                            onDone={() => fetchDisputes()}
                            onClose={() => setExpandedDisputeId(null)}
                            colSpan={8}
                          />
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination footer */}
            {totalPendingPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--qa-border)' }}>
                <span style={{ fontSize: 13, color: 'var(--qa-text-2)' }}>Page {pendingPage} of {totalPendingPages}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setPendingPage(p => Math.max(1, p - 1))}
                    disabled={pendingPage === 1}
                    style={{ height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: pendingPage === 1 ? 'not-allowed' : 'pointer', opacity: pendingPage === 1 ? 0.5 : 1 }}
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setPendingPage(p => Math.min(totalPendingPages, p + 1))}
                    disabled={pendingPage >= totalPendingPages}
                    style={{ height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: pendingPage >= totalPendingPages ? 'not-allowed' : 'pointer', opacity: pendingPage >= totalPendingPages ? 0.5 : 1 }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: REVIEWED DISPUTES ────────────────────────────────────────── */}
      {activeTab === 'reviewed' && (
        <div>
          {/* Filters Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <select
              value={reviewedAgentFilter}
              onChange={e => { setReviewedAgentFilter(e.target.value); setReviewedPage(1); }}
              style={{ ...chipInputStyle, minWidth: 140 }}
            >
              <option value="">All Agents</option>
              {Array.from(new Set(reviewedDisputes.map(d => d.agentName).filter(Boolean))).sort().map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <select
              value={reviewedOutcomeFilter}
              onChange={e => { setReviewedOutcomeFilter(e.target.value); setReviewedPage(1); }}
              style={{ ...chipInputStyle, minWidth: 140 }}
            >
              <option value="">All Outcomes</option>
              <option value="updated">Updated by QA</option>
              <option value="resolved_qa">Resolved by QA</option>
              <option value="resolved_tl">Resolved by TL</option>
              <option value="forwarded">Forwarded by TL</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <input
              type="date"
              value={reviewedFromFilter}
              onChange={e => { setReviewedFromFilter(e.target.value); setReviewedPage(1); }}
              style={chipInputStyle}
              title="From Date"
            />
            <input
              type="date"
              value={reviewedToFilter}
              onChange={e => { setReviewedToFilter(e.target.value); setReviewedPage(1); }}
              style={chipInputStyle}
              title="To Date"
            />

            {(reviewedAgentFilter || reviewedOutcomeFilter || reviewedFromFilter || reviewedToFilter) && (
              <button
                onClick={() => {
                  setReviewedAgentFilter('');
                  setReviewedOutcomeFilter('');
                  setReviewedFromFilter('');
                  setReviewedToFilter('');
                  setReviewedPage(1);
                }}
                style={{ height: 32, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 8, background: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                Clear Filters
              </button>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
                {filteredReviewedDisputes.length === 0 ? '0 disputes' : `Showing ${(reviewedPage - 1) * reviewedLimit + 1}–${Math.min(reviewedPage * reviewedLimit, filteredReviewedDisputes.length)} of ${filteredReviewedDisputes.length}`}
              </span>
              <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenPageDrop(openPageDrop === 'tab3' ? null : 'tab3')}
                  style={{ height: 28, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}
                >
                  {reviewedLimit} / page ▾
                </button>
                {openPageDrop === 'tab3' && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50, background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    {[20, 50, 100].map(n => (
                      <div
                        key={n}
                        onClick={() => { setReviewedLimit(n); setReviewedPage(1); setOpenPageDrop(null); }}
                        style={{ padding: '6px 16px', fontSize: 12, cursor: 'pointer', background: reviewedLimit === n ? '#f4f4f5' : '#fff' }}
                      >
                        {n} rows
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th style={TH_BASE}>Call ID</th>
                  <th style={TH_BASE}>Agent Name</th>
                  <th style={TH_BASE}>Raised By</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                  <th style={TH_BASE}>Linked Chat</th>
                  <th style={TH_BASE}>Status</th>
                  <th style={TH_BASE}>Date Raised</th>
                </tr>
              </thead>
              <tbody>
                {loadingReviewed ? (
                  <tr>
                    <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading reviewed call disputes…
                    </td>
                  </tr>
                ) : filteredReviewedDisputes.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      No reviewed call disputes found for your team.
                    </td>
                  </tr>
                ) : (
                  pagedReviewed.map(dispute => {
                    const isOpen = expandedDisputeId === dispute.flagId;
                    const callKey = dispute.callId || dispute.chatId;

                    return (
                      <Fragment key={dispute.flagId}>
                        <tr
                          onClick={() => setExpandedDisputeId(isOpen ? null : dispute.flagId)}
                          style={{ cursor: 'pointer', background: isOpen ? 'var(--qa-gray-50)' : undefined }}
                        >
                          <td style={TD_MONO}>{callKey}</td>
                          <td style={{ ...TD_BASE, fontWeight: 500 }}>{dispute.agentName}</td>
                          <td style={TD_BASE}>{dispute.raisedByName} ({dispute.raisedBy})</td>
                          <td style={TD_NUM}>
                            <IQSBadge score={dispute.callIqsScore ?? dispute.iqsScore} />
                          </td>
                          <td style={TD_BASE} onClick={e => e.stopPropagation()}>
                            {dispute.chatId ? (
                              <a
                                href={`https://app.robylon.ai/unified-inbox/share/${dispute.chatId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '3px 8px',
                                  fontSize: 12,
                                  fontWeight: 500,
                                  borderRadius: 6,
                                  border: '1px solid var(--qa-border, #E4E4E7)',
                                  background: '#fff',
                                  color: '#2563eb',
                                  textDecoration: 'none',
                                  whiteSpace: 'nowrap',
                                }}
                                title={`Open chat ${dispute.chatId} in Robylon`}
                              >
                                Show chat ↗
                              </a>
                            ) : (
                              <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13 }}>—</span>
                            )}
                          </td>
                          <td style={TD_BASE}>
                            <DisputeStatusPill
                              status={dispute.status}
                              raisedByRole={dispute.raisedByRole || (dispute as any).raisedBy}
                              reviewNote={dispute.reviewNote}
                              parameters={dispute.parameters}
                            />
                          </td>
                          <td style={TD_BASE}>{new Date(dispute.raisedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        </tr>

                        {isOpen && (
                          <CallEvalPanel
                            callId={callKey}
                            chatId={dispute.chatId}
                            agentName={dispute.agentName}
                            iqsScore={dispute.callIqsScore ?? dispute.iqsScore ?? 0}
                            calledAt={dispute.closedAt || dispute.raisedAt}
                            disposition={dispute.disposition}
                            gates={dispute.gates || dispute.parameters?.gates}
                            iqsScores={dispute.parameters || {}}
                            mode="view"
                            dispute={dispute}
                            onDone={() => fetchDisputes()}
                            onClose={() => setExpandedDisputeId(null)}
                            colSpan={7}
                          />
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Pagination footer */}
            {totalReviewedPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--qa-border)' }}>
                <span style={{ fontSize: 13, color: 'var(--qa-text-2)' }}>Page {reviewedPage} of {totalReviewedPages}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setReviewedPage(p => Math.max(1, p - 1))}
                    disabled={reviewedPage === 1}
                    style={{ height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: reviewedPage === 1 ? 'not-allowed' : 'pointer', opacity: reviewedPage === 1 ? 0.5 : 1 }}
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setReviewedPage(p => Math.min(totalReviewedPages, p + 1))}
                    disabled={reviewedPage >= totalReviewedPages}
                    style={{ height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6, background: '#fff', fontSize: 12, cursor: reviewedPage >= totalReviewedPages ? 'not-allowed' : 'pointer', opacity: reviewedPage >= totalReviewedPages ? 0.5 : 1 }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
