'use client';

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import type { CSSProperties } from 'react';
import CallEvalPanel from '../quality/CallEvalPanel';

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

interface DisputeRow {
  flagId: string;
  chatId: string;
  callId?: string;
  iqsScore: number | null;
  botIqsScore?: number | null;
  callIqsScore?: number | null;
  csatScore?: number | null;
  disposition?: string;
  subDisposition?: string;
  closedAt: string;
  status: string;
  challengedParams: { param: string; note: string }[];
  agentNote: string;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
  parameters: Record<string, any> | null;
  flaggedAt: string;
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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');

  // Pagination
  const [page, setPage] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);

  // Disputes state
  const [pendingDisputes, setPendingDisputes] = useState<DisputeRow[]>([]);
  const [reviewedDisputes, setReviewedDisputes] = useState<DisputeRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingReviewed, setLoadingReviewed] = useState(true);
  const [expandedDisputeId, setExpandedDisputeId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Raise Dispute Form state for expanded evaluated call
  const [raisingForCallId, setRaisingForCallId] = useState<string | null>(null);
  const [selectedParams, setSelectedParams] = useState<Record<string, boolean>>({});
  const [paramNotes, setParamNotes] = useState<Record<string, string>>({});
  const [agentDisputeNote, setAgentDisputeNote] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);

  // Fetch Evaluated Calls
  const fetchEvaluatedCalls = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const p = new URLSearchParams({
        agent: agentName,
        page: String(page),
      });
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      if (iqsMin) p.set('minScore', iqsMin);
      if (iqsMax) p.set('maxScore', iqsMax);

      const res = await fetch(`/api/call-quality/scores?${p}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      let rows: CallScoreEntry[] = Array.isArray(data.entries) ? data.entries : [];
      if (callIdSearch) {
        rows = rows.filter(r => r.callId.toLowerCase().includes(callIdSearch.toLowerCase()) || (r.chatId && r.chatId.toLowerCase().includes(callIdSearch.toLowerCase())));
      }
      if (disposition) {
        rows = rows.filter(r => (r.disposition || '').toLowerCase().includes(disposition.toLowerCase()));
      }
      setEntries(rows);
      setTotalEntries(data.total ?? rows.length);
    } catch {
      setEntries([]);
      setTotalEntries(0);
    } finally {
      setLoadingEntries(false);
    }
  }, [agentName, page, callIdSearch, disposition, dateFrom, dateTo, iqsMin, iqsMax]);

  useEffect(() => {
    fetchEvaluatedCalls();
  }, [fetchEvaluatedCalls]);

  // Fetch Disputes
  const fetchDisputes = useCallback(async () => {
    setLoadingPending(true);
    setLoadingReviewed(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/ir/disputes?status=pending'),
        fetch('/api/ir/disputes?status=resolved'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);
      
      const pAll: DisputeRow[] = Array.isArray(pData.disputes) ? pData.disputes : [];
      const rAll: DisputeRow[] = Array.isArray(rData.disputes) ? rData.disputes : [];

      // Filter for disputes that have callId or call parameters (P1..P11)
      const isCallDispute = (d: DisputeRow) => Boolean(d.callId || d.callIqsScore != null || d.challengedParams?.some(p => p.param.startsWith('P')));

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

  const pendingCallIdMap = new Map(pendingDisputes.map(d => [d.callId || d.chatId, d]));
  const reviewedCallIdMap = new Map(reviewedDisputes.map(d => [d.callId || d.chatId, d]));

  const handleToggleParam = (paramKey: string) => {
    setSelectedParams(prev => ({ ...prev, [paramKey]: !prev[paramKey] }));
  };

  const handleNoteChange = (paramKey: string, note: string) => {
    setParamNotes(prev => ({ ...prev, [paramKey]: note }));
  };

  const handleRaiseDisputeSubmit = async (call: CallScoreEntry) => {
    const challenged = Object.keys(selectedParams)
      .filter(k => selectedParams[k])
      .map(k => ({ param: k, note: paramNotes[k] || '' }));

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
          callId: call.callId,
          chatId: call.chatId || call.callId,
          agentNote: agentDisputeNote,
          challengedParams: challenged,
        }),
      });

      if (res.ok) {
        alert('Dispute raised successfully to your Team Lead!');
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
          My Quality Calls
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)', margin: 0 }}>
          View evaluated call recordings, inspect IQS scores, raise disputes to your Team Lead, and track raised and reviewed disputes.
        </p>
      </div>

      {/* Navigation Tabs */}
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
            <input
              type="text"
              placeholder="Search Call ID / Chat ID…"
              value={callIdSearch}
              onChange={e => setCallIdSearch(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                border: '1px solid var(--qa-border, #E4E4E7)',
                borderRadius: 8,
                fontSize: 13,
                outline: 'none',
                minWidth: 200,
              }}
            />

            <input
              type="text"
              placeholder="Disposition…"
              value={disposition}
              onChange={e => setDisposition(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                border: '1px solid var(--qa-border, #E4E4E7)',
                borderRadius: 8,
                fontSize: 13,
                outline: 'none',
                minWidth: 160,
              }}
            />

            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, fontSize: 13, background: '#fff' }}
              placeholder="From Date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, fontSize: 13, background: '#fff' }}
              placeholder="To Date"
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                placeholder="Min IQS"
                value={iqsMin}
                onChange={e => setIqsMin(e.target.value)}
                style={{ width: 80, height: 36, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, fontSize: 13 }}
              />
              <span style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>to</span>
              <input
                type="number"
                placeholder="Max IQS"
                value={iqsMax}
                onChange={e => setIqsMax(e.target.value)}
                style={{ width: 80, height: 36, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, fontSize: 13 }}
              />
            </div>

            {(callIdSearch || disposition || dateFrom || dateTo || iqsMin || iqsMax) && (
              <button
                onClick={() => {
                  setCallIdSearch('');
                  setDisposition('');
                  setDateFrom('');
                  setDateTo('');
                  setIqsMin('');
                  setIqsMax('');
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
                Reset Filters
              </button>
            )}
          </div>

          {/* Calls Table */}
          <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th style={TH_BASE}>Call ID</th>
                  <th style={TH_BASE}>Date / Time</th>
                  <th style={TH_BASE}>Disposition</th>
                  <th style={TH_BASE}>Duration</th>
                  <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS Score</th>
                  <th style={{ ...TH_BASE, textAlign: 'center' }}>Dispute Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingEntries ? (
                  <tr>
                    <td colSpan={6} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                      Loading evaluated calls…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
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
                          <td style={TD_BASE}>
                            {call.calledAt ? new Date(call.calledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : call.date}
                          </td>
                          <td style={TD_BASE}>{call.disposition || '—'}</td>
                          <td style={TD_MONO}>{fmtDuration(call.durationSeconds)}</td>
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
                            colSpan={6}
                          />
                        )}

                        {/* Inline Dispute Raising Form */}
                        {isExpanded && isRaising && !pendingDispute && !reviewedDispute && (
                          <tr>
                            <td colSpan={6} style={{ padding: 20, background: '#fefce8', borderBottom: '1px solid #fef08a' }}>
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
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => handleToggleParam(pKey)}
                                          />
                                          {CALL_PARAM_NAMES[pKey]} ({scoreVal})
                                        </label>
                                        {isChecked && (
                                          <input
                                            type="text"
                                            placeholder="Reason for challenge…"
                                            value={paramNotes[pKey] || ''}
                                            onChange={e => handleNoteChange(pKey, e.target.value)}
                                            style={{
                                              width: '100%',
                                              marginTop: 6,
                                              padding: '4px 8px',
                                              fontSize: 12,
                                              border: '1px solid #d1d5db',
                                              borderRadius: 4,
                                              outline: 'none',
                                            }}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                <div style={{ marginBottom: 16 }}>
                                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#713f12', marginBottom: 4 }}>
                                    Overall Dispute Note for TL:
                                  </label>
                                  <textarea
                                    rows={3}
                                    placeholder="Explain why this call evaluation should be reviewed by your Team Lead..."
                                    value={agentDisputeNote}
                                    onChange={e => setAgentDisputeNote(e.target.value)}
                                    style={{
                                      width: '100%',
                                      padding: 8,
                                      fontSize: 13,
                                      border: '1px solid #d1d5db',
                                      borderRadius: 6,
                                      outline: 'none',
                                    }}
                                  />
                                </div>

                                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => setRaisingForCallId(null)}
                                    style={{ padding: '6px 14px', fontSize: 13, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleRaiseDisputeSubmit(call)}
                                    disabled={submittingDispute}
                                    style={{
                                      padding: '6px 16px',
                                      fontSize: 13,
                                      fontWeight: 600,
                                      background: '#854d0e',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 6,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {submittingDispute ? 'Submitting Dispute…' : 'Submit Dispute to TL'}
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
          </div>
        </div>
      )}

      {/* ── TAB 2: DISPUTES RAISED (PENDING) ────────────────────────────────── */}
      {activeTab === 'disputes' && (
        <div style={{ background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={TH_BASE}>Call / Chat ID</th>
                <th style={TH_BASE}>Date Raised</th>
                <th style={TH_BASE}>Challenged Params</th>
                <th style={TH_BASE}>Status</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingPending ? (
                <tr>
                  <td colSpan={5} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    Loading raised disputes…
                  </td>
                </tr>
              ) : pendingDisputes.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    No pending call disputes raised.
                  </td>
                </tr>
              ) : (
                pendingDisputes.map(dispute => {
                  const isOpen = expandedDisputeId === dispute.flagId;
                  const isPendingTL = dispute.status === 'pending' || dispute.status === 'ir_pending_tl';
                  return (
                    <Fragment key={dispute.flagId}>
                      <tr
                        onClick={() => setExpandedDisputeId(isOpen ? null : dispute.flagId)}
                        style={{ cursor: 'pointer', background: isOpen ? 'var(--qa-gray-50)' : undefined }}
                      >
                        <td style={TD_MONO}>{dispute.callId || dispute.chatId}</td>
                        <td style={TD_BASE}>{new Date(dispute.flaggedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td style={TD_BASE}>
                          {dispute.challengedParams?.length ? (
                            <span style={{ fontSize: 12, color: 'var(--qa-text)' }}>
                              {dispute.challengedParams.map(p => p.param).join(', ')}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={TD_BASE}>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                            background: isPendingTL ? '#fefce8' : '#e0f2fe',
                            color: isPendingTL ? '#854d0e' : '#0369a1',
                            border: `1px solid ${isPendingTL ? '#fef08a' : '#bae6fd'}`,
                          }}>
                            {isPendingTL ? 'Awaiting TL Review' : 'Forwarded to QA'}
                          </span>
                        </td>
                        <td style={{ ...TD_BASE, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          {isPendingTL && (
                            <button
                              onClick={() => cancelDispute(dispute.flagId)}
                              disabled={cancellingId === dispute.flagId}
                              style={{ padding: '4px 10px', fontSize: 12, background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer' }}
                            >
                              {cancellingId === dispute.flagId ? 'Canceling…' : 'Cancel Dispute'}
                            </button>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ padding: 20, background: '#f8fafc', borderBottom: '1px solid var(--qa-border)' }}>
                            <div style={{ maxWidth: 800 }}>
                              <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>Dispute Details</h4>
                              <p style={{ fontSize: 13, color: 'var(--qa-text-2)', marginBottom: 12 }}>
                                <b>Agent Note:</b> {dispute.agentNote || 'No note provided'}
                              </p>
                              {dispute.challengedParams?.length > 0 && (
                                <div style={{ marginBottom: 12 }}>
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
                <th style={TH_BASE}>Date Raised</th>
                <th style={TH_BASE}>Reviewed By</th>
                <th style={TH_BASE}>Status</th>
                <th style={TH_BASE}>Review Note</th>
              </tr>
            </thead>
            <tbody>
              {loadingReviewed ? (
                <tr>
                  <td colSpan={5} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    Loading reviewed disputes…
                  </td>
                </tr>
              ) : reviewedDisputes.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...TD_BASE, textAlign: 'center', color: 'var(--qa-text-2)' }}>
                    No reviewed call disputes found.
                  </td>
                </tr>
              ) : (
                reviewedDisputes.map(dispute => (
                  <tr key={dispute.flagId}>
                    <td style={TD_MONO}>{dispute.callId || dispute.chatId}</td>
                    <td style={TD_BASE}>{new Date(dispute.flaggedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td style={TD_BASE}>{dispute.reviewedBy || '—'}</td>
                    <td style={TD_BASE}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                        {dispute.status}
                      </span>
                    </td>
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
