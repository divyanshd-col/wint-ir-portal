'use client';

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import type { CSSProperties } from 'react';
import CallEvalPanel from '../quality/CallEvalPanel';
import { DisputeThread } from '../quality/DisputeThread';
import { DisputeStatusPill, getDisputeOutcomeKey } from '@/components/tl/QualityChatsPage';

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
  mobileNumber?: string | null;
}

interface DisputeRow {
  flagId: string;
  chatId: string;
  callId?: string;
  agentName?: string;
  iqsScore: number | null;
  botIqsScore?: number | null;
  callIqsScore?: number | null;
  csatScore?: number | null;
  disposition?: string;
  subDisposition?: string;
  closedAt: string;
  status: string;
  raisedByRole?: 'ir' | 'tl' | string;
  challengedParams: { param: string; note: string }[];
  agentNote: string;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
  parameters: Record<string, any> | null;
  gates?: any;
  flaggedAt: string;
  mobileNumber?: string | null;
}

interface Props {
  agentName: string;
}

export default function MyQualityCallsPage({ agentName }: Props) {
  const [activeTab, setActiveTab] = useState<'evaluated' | 'disputes' | 'reviewed'>('evaluated');

  // Evaluated Calls State
  const [entries, setEntries] = useState<CallScoreEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Filters state
  const [callIdSearch, setCallIdSearch] = useState('');
  const [disposition, setDisposition] = useState('');
  const [subDisposition, setSubDisposition] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');
  const [qualityParam, setQualityParam] = useState('');

  // Pagination
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [totalEntries, setTotalEntries] = useState(0);

  // Disputes state
  const [pendingDisputes, setPendingDisputes] = useState<DisputeRow[]>([]);
  const [reviewedDisputes, setReviewedDisputes] = useState<DisputeRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingReviewed, setLoadingReviewed] = useState(true);
  const [expandedDisputeId, setExpandedDisputeId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Filter state for Disputes
  const [pendingOutcomeFilter, setPendingOutcomeFilter] = useState('');
  const [pendingFromFilter, setPendingFromFilter] = useState('');
  const [pendingToFilter, setPendingToFilter] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingLimit, setPendingLimit] = useState(20);

  const [reviewedOutcomeFilter, setReviewedOutcomeFilter] = useState('');
  const [reviewedFromFilter, setReviewedFromFilter] = useState('');
  const [reviewedToFilter, setReviewedToFilter] = useState('');
  const [reviewedPage, setReviewedPage] = useState(1);
  const [reviewedLimit, setReviewedLimit] = useState(20);

  const [openPageDrop, setOpenPageDrop] = useState<'tab1' | 'tab2' | 'tab3' | null>(null);

  // Raise Dispute Form state for expanded evaluated call
  const [raisingForCallId, setRaisingForCallId] = useState<string | null>(null);
  const [selectedParams, setSelectedParams] = useState<Record<string, boolean>>({});
  const [paramNotes, setParamNotes] = useState<Record<string, string>>({});
  const [agentDisputeNote, setAgentDisputeNote] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);

  useEffect(() => {
    const handleOutside = () => setOpenPageDrop(null);
    window.addEventListener('click', handleOutside);
    return () => window.removeEventListener('click', handleOutside);
  }, []);

  // Fetch Evaluated Calls
  const fetchEvaluatedCalls = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const p = new URLSearchParams({
        agent: agentName,
        page: String(page),
        limit: String(limit),
      });
      if (callIdSearch) p.set('callId', callIdSearch);
      if (disposition) p.set('tag', disposition);
      if (subDisposition) p.set('subTag', subDisposition);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      if (iqsMin) p.set('minScore', iqsMin);
      if (iqsMax) p.set('maxScore', iqsMax);

      const res = await fetch(`/api/call-quality/scores?${p}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      let rows: CallScoreEntry[] = Array.isArray(data.entries) ? data.entries : [];
      // Ensure only calls (with callId) are shown
      rows = rows.filter(r => Boolean(r.callId));
      if (qualityParam) {
        rows = rows.filter(r => r.scores?.[qualityParam] === 'No' || r.scores?.[qualityParam] === '0');
      }
      setEntries(rows);
      setTotalEntries(data.total ?? rows.length);
    } catch {
      setEntries([]);
      setTotalEntries(0);
    } finally {
      setLoadingEntries(false);
    }
  }, [agentName, page, limit, callIdSearch, disposition, subDisposition, dateFrom, dateTo, iqsMin, iqsMax, qualityParam]);

  useEffect(() => {
    fetchEvaluatedCalls();
  }, [fetchEvaluatedCalls]);

  // Fetch Disputes
  const fetchDisputes = useCallback(async () => {
    setLoadingPending(true);
    setLoadingReviewed(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/ir/disputes?status=pending&type=calls'),
        fetch('/api/ir/disputes?status=resolved&type=calls'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);

      const pAll: DisputeRow[] = Array.isArray(pData.disputes) ? pData.disputes : [];
      const rAll: DisputeRow[] = Array.isArray(rData.disputes) ? rData.disputes : [];

      const isCallDispute = (d: DisputeRow) => Boolean(d.callId);

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

  const cancelDispute = async (flagId: string) => {
    setCancellingId(flagId);
    try {
      await fetch('/api/quality/flag', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: flagId, status: 'cancelled', action: 'cancel' }),
      });
      await fetchDisputes();
    } finally {
      setCancellingId(null);
    }
  };

  const handleRaiseDisputeSubmit = async (callId: string, chatId?: string | null) => {
    const challenged = Object.entries(selectedParams)
      .filter(([, checked]) => checked)
      .map(([paramKey]) => ({
        param: paramKey,
        note: paramNotes[paramKey] || '',
      }));

    if (challenged.length === 0) {
      alert('Please select at least one parameter to challenge.');
      return;
    }

    setSubmittingDispute(true);
    try {
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          chatId: chatId || callId,
          agentNote: agentDisputeNote,
          challengedParams: challenged,
        }),
      });

      if (res.ok) {
        alert('Dispute raised successfully!');
        setRaisingForCallId(null);
        setSelectedParams({});
        setParamNotes({});
        setAgentDisputeNote('');
        await fetchDisputes();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to raise dispute');
      }
    } catch (e: any) {
      alert(`Error raising dispute: ${e.message}`);
    } finally {
      setSubmittingDispute(false);
    }
  };

  // Map of active/disputed flagIds strictly by callId
  const pendingCallIdMap = new Map<string, DisputeRow>();
  pendingDisputes.forEach(d => {
    if (d.callId) pendingCallIdMap.set(d.callId, d);
  });

  const reviewedCallIdMap = new Map<string, DisputeRow>();
  reviewedDisputes.forEach(d => {
    if (d.callId) reviewedCallIdMap.set(d.callId, d);
  });

  // Filter pending disputes
  const filteredPendingDisputes = pendingDisputes.filter(row => {
    if (pendingOutcomeFilter && getDisputeOutcomeKey(row as any) !== pendingOutcomeFilter) return false;
    if (pendingFromFilter) {
      const dDate = row.flaggedAt ? row.flaggedAt.substring(0, 10) : '';
      if (dDate < pendingFromFilter) return false;
    }
    if (pendingToFilter) {
      const dDate = row.flaggedAt ? row.flaggedAt.substring(0, 10) : '';
      if (dDate > pendingToFilter) return false;
    }
    return true;
  });

  // Filter reviewed disputes
  const filteredReviewedDisputes = reviewedDisputes.filter(row => {
    if (reviewedOutcomeFilter && getDisputeOutcomeKey(row as any) !== reviewedOutcomeFilter) return false;
    if (reviewedFromFilter) {
      const dDate = row.reviewedAt ? row.reviewedAt.substring(0, 10) : row.flaggedAt ? row.flaggedAt.substring(0, 10) : '';
      if (dDate < reviewedFromFilter) return false;
    }
    if (reviewedToFilter) {
      const dDate = row.reviewedAt ? row.reviewedAt.substring(0, 10) : row.flaggedAt ? row.flaggedAt.substring(0, 10) : '';
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
    fontFamily: SANS,
    fontSize: 13,
    fontWeight: active ? 600 : 400,
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
    <div style={{ padding: 24, background: '#F7F7F8', minHeight: '100%', fontFamily: SANS, WebkitFontSmoothing: 'antialiased' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>
          My Quality Calls
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)', margin: '4px 0 0' }}>
          View evaluated calls, raise disputes to your Team Lead, and track raised and reviewed disputes.
        </p>
      </div>

      {/* Tabs */}
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
          {/* Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search Call ID…"
              value={callIdSearch}
              onChange={e => { setCallIdSearch(e.target.value); setPage(0); }}
              style={{ ...chipInputStyle, width: 140 }}
            />
            <input
              type="text"
              placeholder="Disposition…"
              value={disposition}
              onChange={e => { setDisposition(e.target.value); setPage(0); }}
              style={{ ...chipInputStyle, width: 130 }}
            />
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

            <select
              value={qualityParam}
              onChange={e => { setQualityParam(e.target.value); setPage(0); }}
              style={{ ...chipInputStyle, minWidth: 160 }}
            >
              <option value="">All Parameters</option>
              {Object.entries(CALL_PARAM_NAMES).map(([k, label]) => (
                <option key={k} value={k}>Failed {label}</option>
              ))}
            </select>

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

            {(callIdSearch || disposition || dateFrom || dateTo || qualityParam || iqsMin || iqsMax) && (
              <button
                onClick={() => {
                  setCallIdSearch('');
                  setDisposition('');
                  setDateFrom('');
                  setDateTo('');
                  setQualityParam('');
                  setIqsMin('');
                  setIqsMax('');
                  setPage(0);
                }}
                style={{ height: 32, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 8, background: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                Clear Filters
              </button>
            )}

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
                  <th style={TH_BASE}>Mobile</th>
                  <th style={TH_BASE}>Date / Time</th>
                  <th style={TH_BASE}>Disposition</th>
                  <th style={TH_BASE}>Linked Chat</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS Score</th>
                  <th style={{ ...TH_BASE, textAlign: 'center' }}>Dispute Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingEntries ? (
                  <tr>
                    <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading evaluated calls…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      No evaluated calls found.
                    </td>
                  </tr>
                ) : (
                  entries.map((call) => {
                    const isExpanded = expandedCallId === call.callId;
                    const pendingDispute = pendingCallIdMap.get(call.callId) || (call.chatId ? pendingCallIdMap.get(call.chatId) : undefined);
                    const reviewedDispute = reviewedCallIdMap.get(call.callId) || (call.chatId ? reviewedCallIdMap.get(call.chatId) : undefined);
                    const isRaising = raisingForCallId === call.callId;

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
                          <td style={TD_MONO}>{call.mobileNumber || <span style={{ color: 'var(--qa-text-3, #A1A1AA)' }}>—</span>}</td>
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
                          <td style={{ ...TD_BASE, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            {pendingDispute ? (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#fefce8', color: '#854d0e', border: '1px solid #fef08a' }}>
                                Dispute Pending TL
                              </span>
                            ) : reviewedDispute ? (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                                Dispute Reviewed
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setExpandedCallId(call.callId);
                                  setRaisingForCallId(call.callId);
                                }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: 'var(--qa-gray-700, #27272A)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 6,
                                  cursor: 'pointer',
                                }}
                              >
                                Raise Dispute
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Expanded Call View */}
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
                            mobileNumber={call.mobileNumber}
                            colSpan={7}
                          />
                        )}

                        {/* Inline Dispute Raising Form */}
                        {isExpanded && isRaising && !pendingDispute && !reviewedDispute && (
                          <tr>
                            <td colSpan={7} style={{ padding: 20, background: '#fefce8', borderBottom: '1px solid #fef08a' }}>
                              <div style={{ maxWidth: 800, margin: '0 auto' }}>
                                <h4 style={{ margin: '0 0 10px 0', fontSize: 15, fontWeight: 600, color: '#854d0e' }}>
                                  Raise Call Quality Dispute (ID: {call.callId})
                                </h4>
                                <p style={{ fontSize: 13, color: '#713f12', marginBottom: 12 }}>
                                  Select the parameters you want to challenge and add a brief explanation for your Team Lead:
                                </p>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10, marginBottom: 16 }}>
                                  {Object.keys(CALL_PARAM_NAMES).map((pKey) => {
                                    const scoreVal = call.scores?.[pKey] ?? 'NA';
                                    const isChecked = Boolean(selectedParams[pKey]);
                                    return (
                                      <div
                                        key={pKey}
                                        style={{
                                          padding: 10,
                                          background: '#fff',
                                          border: `1px solid ${isChecked ? '#eab308' : '#e5e7eb'}`,
                                          borderRadius: 8,
                                        }}
                                      >
                                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 4 }}>
                                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={(e) =>
                                                setSelectedParams((prev) => ({
                                                  ...prev,
                                                  [pKey]: e.target.checked,
                                                }))
                                              }
                                              style={{ marginRight: 8 }}
                                            />
                                            {CALL_PARAM_NAMES[pKey]}
                                          </span>
                                          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', color: '#374151' }}>
                                            Score: {scoreVal}
                                          </span>
                                        </label>

                                        {isChecked && (
                                          <input
                                            type="text"
                                            placeholder="Reasoning for this parameter challenge…"
                                            value={paramNotes[pKey] || ''}
                                            onChange={(e) =>
                                              setParamNotes((prev) => ({
                                                ...prev,
                                                [pKey]: e.target.value,
                                              }))
                                            }
                                            style={{
                                              width: '100%',
                                              fontSize: 12,
                                              padding: '6px 8px',
                                              border: '1px solid #d1d5db',
                                              borderRadius: 6,
                                              marginTop: 6,
                                              outline: 'none',
                                            }}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                <div style={{ marginBottom: 16 }}>
                                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#713f12', marginBottom: 6 }}>
                                    Overall Explanation Note for TL:
                                  </label>
                                  <textarea
                                    value={agentDisputeNote}
                                    onChange={(e) => setAgentDisputeNote(e.target.value)}
                                    placeholder="Explain why you are disputing this call quality evaluation…"
                                    rows={3}
                                    style={{
                                      width: '100%',
                                      fontSize: 13,
                                      padding: '8px 10px',
                                      border: '1px solid #d1d5db',
                                      borderRadius: 6,
                                      outline: 'none',
                                      resize: 'vertical',
                                    }}
                                  />
                                </div>

                                <div style={{ display: 'flex', gap: 10 }}>
                                  <button
                                    onClick={() => handleRaiseDisputeSubmit(call.callId, call.chatId)}
                                    disabled={submittingDispute}
                                    style={{
                                      padding: '8px 16px',
                                      fontSize: 13,
                                      fontWeight: 600,
                                      background: '#854d0e',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 6,
                                      cursor: submittingDispute ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    {submittingDispute ? 'Submitting Dispute…' : 'Submit Dispute to TL'}
                                  </button>
                                  <button
                                    onClick={() => setRaisingForCallId(null)}
                                    style={{
                                      padding: '8px 16px',
                                      fontSize: 13,
                                      fontWeight: 500,
                                      background: '#fff',
                                      color: '#4b5563',
                                      border: '1px solid #d1d5db',
                                      borderRadius: 6,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Cancel
                                  </button>
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

      {/* ── TAB 2: DISPUTES RAISED (PENDING TL REVIEW) ───────────────────────── */}
      {activeTab === 'disputes' && (
        <div>
          {/* Filters Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
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

            {(pendingOutcomeFilter || pendingFromFilter || pendingToFilter) && (
              <button
                onClick={() => {
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
                  <th style={TH_BASE}>Mobile</th>
                  <th style={TH_BASE}>Date / Time</th>
                  <th style={TH_BASE}>Disposition</th>
                  <th style={TH_BASE}>Linked Chat</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                  <th style={TH_BASE}>Status</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingPending ? (
                  <tr>
                    <td colSpan={8} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading raised disputes…
                    </td>
                  </tr>
                ) : filteredPendingDisputes.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      No pending call disputes found.
                    </td>
                  </tr>
                ) : (
                  pagedPending.map((dispute) => {
                    const isOpen = expandedDisputeId === dispute.flagId;
                    const callKey = dispute.callId || dispute.chatId;

                    return (
                      <Fragment key={dispute.flagId}>
                        <tr
                          onClick={() => setExpandedDisputeId(isOpen ? null : dispute.flagId)}
                          style={{
                            background: isOpen ? 'var(--qa-gray-50, #FAFAFB)' : undefined,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <td style={TD_MONO}>
                            {/^\d+$/.test(String(callKey).trim()) ? (
                              <a
                                href={`https://app.robylon.ai/unified-inbox/share/${String(callKey).trim()}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                style={{ color: 'var(--qa-text, #111111)', textDecoration: 'underline', textDecorationColor: '#C7C7CC', fontFamily: MONO, fontSize: 13 }}
                              >
                                {callKey}
                              </a>
                            ) : (
                              callKey
                            )}
                          </td>
                          <td style={TD_MONO}>{dispute.mobileNumber || <span style={{ color: 'var(--qa-text-3, #A1A1AA)' }}>—</span>}</td>
                          <td style={TD_BASE}>
                            {dispute.closedAt ? new Date(dispute.closedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
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
                          <td style={TD_NUM}>
                            <IQSBadge score={dispute.callIqsScore ?? dispute.iqsScore} />
                          </td>
                          <td style={TD_BASE}>
                            <DisputeStatusPill
                              status={dispute.status}
                              raisedByRole={dispute.raisedByRole}
                              reviewNote={dispute.reviewNote}
                              parameters={dispute.parameters}
                            />
                          </td>
                          <td style={{ ...TD_BASE, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => cancelDispute(dispute.flagId)}
                              disabled={cancellingId === dispute.flagId}
                              style={{
                                padding: '4px 10px',
                                fontSize: 12,
                                fontWeight: 500,
                                background: '#fff',
                                color: '#b91c1c',
                                border: '1px solid #fecaca',
                                borderRadius: 6,
                                cursor: cancellingId === dispute.flagId ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {cancellingId === dispute.flagId ? 'Cancelling…' : 'Cancel Dispute'}
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <CallEvalPanel
                            callId={callKey}
                            chatId={dispute.chatId}
                            agentName={dispute.agentName || agentName}
                            iqsScore={dispute.callIqsScore ?? dispute.iqsScore ?? 0}
                            calledAt={dispute.closedAt}
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

            {(reviewedOutcomeFilter || reviewedFromFilter || reviewedToFilter) && (
              <button
                onClick={() => {
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
                  <th style={TH_BASE}>Mobile</th>
                  <th style={TH_BASE}>Date / Time</th>
                  <th style={TH_BASE}>Disposition</th>
                  <th style={TH_BASE}>Linked Chat</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                  <th style={TH_BASE}>Status</th>
                  <th style={TH_BASE}>Reviewed At</th>
                </tr>
              </thead>
              <tbody>
                {loadingReviewed ? (
                  <tr>
                    <td colSpan={8} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading reviewed disputes…
                    </td>
                  </tr>
                ) : filteredReviewedDisputes.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      No reviewed call disputes found.
                    </td>
                  </tr>
                ) : (
                  pagedReviewed.map((dispute) => {
                    const isOpen = expandedDisputeId === dispute.flagId;
                    const callKey = dispute.callId || dispute.chatId;

                    return (
                      <Fragment key={dispute.flagId}>
                        <tr
                          onClick={() => setExpandedDisputeId(isOpen ? null : dispute.flagId)}
                          style={{
                            background: isOpen ? 'var(--qa-gray-50, #FAFAFB)' : undefined,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <td style={TD_MONO}>
                            {/^\d+$/.test(String(callKey).trim()) ? (
                              <a
                                href={`https://app.robylon.ai/unified-inbox/share/${String(callKey).trim()}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                style={{ color: 'var(--qa-text, #111111)', textDecoration: 'underline', textDecorationColor: '#C7C7CC', fontFamily: MONO, fontSize: 13 }}
                              >
                                {callKey}
                              </a>
                            ) : (
                              callKey
                            )}
                          </td>
                          <td style={TD_MONO}>{dispute.mobileNumber || <span style={{ color: 'var(--qa-text-3, #A1A1AA)' }}>—</span>}</td>
                          <td style={TD_BASE}>
                            {dispute.closedAt ? new Date(dispute.closedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
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
                          <td style={TD_NUM}>
                            <IQSBadge score={dispute.callIqsScore ?? dispute.iqsScore} />
                          </td>
                          <td style={TD_BASE}>
                            <DisputeStatusPill
                              status={dispute.status}
                              raisedByRole={dispute.raisedByRole}
                              reviewNote={dispute.reviewNote}
                              parameters={dispute.parameters}
                            />
                          </td>
                          <td style={TD_BASE}>
                            {dispute.reviewedAt ? new Date(dispute.reviewedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                          </td>
                        </tr>

                        {isOpen && (
                          <CallEvalPanel
                            callId={callKey}
                            chatId={dispute.chatId}
                            agentName={dispute.agentName || agentName}
                            iqsScore={dispute.callIqsScore ?? dispute.iqsScore ?? 0}
                            calledAt={dispute.closedAt}
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
