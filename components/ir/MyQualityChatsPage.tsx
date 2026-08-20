'use client';

import React, { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { IQSScoreEntry } from '@/lib/quality';
import { PARAM_NAMES, getDisputeClassification, formatParamLabel } from '@/lib/quality';
import { DisputeThread } from '@/components/quality/DisputeThread';
import IRScorePanel from './IRScorePanel';

// ─── Shared UI Tokens & Styles ────────────────────────────────────────────────

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

// ─── Badges ──────────────────────────────────────────────────────────────────

function IQSBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13, fontWeight: 500 }}>NIL</span>;
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

function CSATBadge({ score }: { score: string | number | null }) {
  if (!score) return <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13 }}>—</span>;
  const s = String(score);
  const label = s === '5' ? 'Good' : s === '3' ? 'Neutral' : s === '1' ? 'Bad' : s;
  const bg = s === '5' ? '#f0fdf4' : s === '3' ? '#fefce8' : '#fef2f2';
  const color = s === '5' ? '#166534' : s === '3' ? '#854d0e' : '#991b1b';
  const border = s === '5' ? '#bbf7d0' : s === '3' ? '#fef08a' : '#fecaca';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        background: bg,
        color: color,
        border: `1px solid ${border}`,
      }}
    >
      {label}
    </span>
  );
}

function ChatIdCell({ chatId }: { chatId: string }) {
  const id = chatId ?? '';
  const display = id.length > 18 ? id.slice(0, 18) + '…' : id;
  const isRobylon = /^\d+$/.test(id.trim());
  if (isRobylon) {
    return (
      <a
        href={`https://app.robylon.ai/unified-inbox/share/${id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--qa-text, #111111)',
          textDecoration: 'underline',
          textDecorationColor: '#C7C7CC',
          fontFamily: MONO,
          fontSize: 13,
        }}
      >
        {display}
      </a>
    );
  }
  return <span style={{ color: 'var(--qa-text-2, #6B6B6B)', fontFamily: MONO, fontSize: 13 }}>{display}</span>;
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

import { DisputeStatusPill, getDisputeOutcomeKey } from '@/components/tl/QualityChatsPage';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface DisputeRow {
  flagId: string;
  chatId: string;
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
  flaggedAt: string;
}

interface Props {
  agentName: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MyQualityChatsPage({ agentName }: Props) {
  const [activeTab, setActiveTab] = useState<'evaluated' | 'disputes' | 'reviewed'>('evaluated');
  const [agentFilter, setAgentFilter] = useState<'all' | 'has_calls'>('all');

  // Evaluated Chats State
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [expandedEvalId, setExpandedEvalId] = useState<string | null>(null);

  // Filters state for Evaluated Chats
  const [chatIdSearch, setChatIdSearch] = useState('');
  const [disposition, setDisposition] = useState('');
  const [subDisposition, setSubDisposition] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [csat, setCsat] = useState('');
  const [qualityParam, setQualityParam] = useState('');
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');

  const [dispositions, setDispositions] = useState<string[]>([]);
  const [dispositionSubMap, setDispositionSubMap] = useState<Record<string, string[]>>({});

  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [totalEntries, setTotalEntries] = useState(0);

  // Disputes state
  const [pendingDisputes, setPendingDisputes] = useState<DisputeRow[]>([]);
  const [reviewedDisputes, setReviewedDisputes] = useState<DisputeRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingReviewed, setLoadingReviewed] = useState(true);
  const [expandedDisputeId, setExpandedDisputeId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Disputes filter state
  const [pendingOutcomeFilter, setPendingOutcomeFilter] = useState('');
  const [pendingFromFilter, setPendingFromFilter] = useState('');
  const [pendingToFilter, setPendingToFilter] = useState('');

  const [reviewedOutcomeFilter, setReviewedOutcomeFilter] = useState('');
  const [reviewedFromFilter, setReviewedFromFilter] = useState('');
  const [reviewedToFilter, setReviewedToFilter] = useState('');

  // Disputes tabs pagination state
  const [pendingPage, setPendingPage] = useState(0);
  const [pendingPageSize, setPendingPageSize] = useState(20);
  const [reviewedPage, setReviewedPage] = useState(0);
  const [reviewedPageSize, setReviewedPageSize] = useState(20);

  const [openPageDrop, setOpenPageDrop] = useState<'tab1' | 'tab2' | 'tab3' | null>(null);

  useEffect(() => {
    const handleOutsideClick = () => setOpenPageDrop(null);
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const filteredPendingDisputes = pendingDisputes.filter((row) => {
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

  const filteredReviewedDisputes = reviewedDisputes.filter((row) => {
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

  // ── Fetch Evaluated Chats ──────────────────────────────────────────────────

  const fetchEvaluatedChats = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const p = new URLSearchParams({
        agent: agentName,
        page: String(page),
        limit: String(pageSize),
        skipStats: '1',
      });
      if (chatIdSearch) p.set('chatId', chatIdSearch);
      if (disposition) p.set('tag', disposition);
      if (subDisposition) p.set('subTag', subDisposition);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      if (csat) p.set('csat', csat);
      if (iqsMin) p.set('minScore', iqsMin);
      if (iqsMax) p.set('maxScore', iqsMax);
      if (agentFilter === 'has_calls') p.set('type', 'has_calls');

      const res = await fetch(`/api/quality/scores?${p}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      let rows: IQSScoreEntry[] = Array.isArray(data.entries) ? data.entries : [];
      if (qualityParam) {
        rows = rows.filter((e) => e.scores?.[qualityParam] === 'No');
      }
      setEntries(rows);
      setTotalEntries(data.total ?? rows.length);
      if (data.availableDispositions) setDispositions(data.availableDispositions);
      if (data.dispositionSubMap) setDispositionSubMap(data.dispositionSubMap);
    } catch {
      setEntries([]);
      setTotalEntries(0);
    } finally {
      setLoadingEntries(false);
    }
  }, [agentName, page, pageSize, chatIdSearch, disposition, subDisposition, dateFrom, dateTo, csat, qualityParam, iqsMin, iqsMax, agentFilter]);

  useEffect(() => {
    fetchEvaluatedChats();
  }, [fetchEvaluatedChats]);

  // ── Fetch Disputes ─────────────────────────────────────────────────────────

  const fetchDisputes = useCallback(async () => {
    setLoadingPending(true);
    setLoadingReviewed(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/ir/disputes?status=pending&type=chats'),
        fetch('/api/ir/disputes?status=resolved&type=chats'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);
      setPendingDisputes(Array.isArray(pData.disputes) ? pData.disputes : []);
      setReviewedDisputes(Array.isArray(rData.disputes) ? rData.disputes : []);
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

  // Map of active/disputed flagIds by chatId
  const pendingChatIdMap = new Map(pendingDisputes.map((d) => [d.chatId, d]));
  const reviewedChatIdMap = new Map(reviewedDisputes.map((d) => [d.chatId, d]));

  const resetFilters = () => {
    setChatIdSearch('');
    setDisposition('');
    setSubDisposition('');
    setDateFrom('');
    setDateTo('');
    setCsat('');
    setQualityParam('');
    setIqsMin('');
    setIqsMax('');
    setPage(0);
  };

  const hasFilters = !!(
    chatIdSearch || disposition || subDisposition || dateFrom || dateTo || csat || qualityParam || iqsMin || iqsMax
  );

  const PARAM_LIST = Object.entries(PARAM_NAMES).map(([key, label]) => ({ key, label }));

  const subDispsForPicked = disposition && dispositionSubMap[disposition] ? dispositionSubMap[disposition] : [];

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 36,
    padding: '0 16px',
    border: 'none',
    borderRadius: 8,
    background: active ? 'var(--qa-gray-700, #111111)' : 'transparent',
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
          My Quality Chats
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)', margin: '4px 0 0' }}>
          View evaluated chats, raise disputes to your Team Lead, and track raised and reviewed disputes.
        </p>
      </div>

      {/* Tabs & Interaction Filter Row */}
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
        {/* Tab Buttons */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--qa-card, #FFFFFF)',
            border: '1px solid var(--qa-border, #E4E4E7)',
            borderRadius: 10,
            padding: 4,
            width: 'fit-content',
          }}
        >
          <button style={tabStyle(activeTab === 'evaluated')} onClick={() => setActiveTab('evaluated')}>
            Evaluated Chats
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

        {/* Agent / Interaction Filter Dropdown */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500 }}>Interaction:</span>
          <select
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value as any);
              setPage(0);
            }}
            style={{
              height: 36,
              padding: '0 28px 0 12px',
              border: '1px solid var(--qa-border, #E4E4E7)',
              borderRadius: 8,
              background: 'var(--qa-card, #FFFFFF)',
              color: 'var(--qa-text, #111111)',
              fontSize: 13,
              fontFamily: SANS,
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage:
                'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23a1a1aa\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              backgroundSize: '12px',
              fontWeight: 500,
            }}
          >
            <option value="all">All Interactions</option>
            <option value="has_calls">Has Calls</option>
          </select>
        </div>
      </div>

      {/* ── TAB 1: EVALUATED CHATS ──────────────────────────────────────────── */}
      {activeTab === 'evaluated' && (
        <div style={{ background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Single-line Filter & Pagination Bar */}
          <div
            style={{
              minHeight: 52,
              background: '#FFFFFF',
              borderBottom: '1px solid var(--qa-border, #E4E4E7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 16px',
              overflowX: 'auto',
            }}
          >
            {/* Filter Inputs (Inline flex group) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Search Chat ID */}
              <input
                type="text"
                placeholder="Search Chat ID…"
                value={chatIdSearch}
                onChange={(e) => setChatIdSearch(e.target.value)}
                style={{ ...chipInputStyle, width: 130 }}
              />

              {/* Disposition */}
              <select
                value={disposition}
                onChange={(e) => {
                  setDisposition(e.target.value);
                  setSubDisposition('');
                }}
                style={{ ...chipInputStyle, maxWidth: 150 }}
              >
                <option value="">All Dispositions</option>
                {dispositions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              {/* Subdisposition */}
              {disposition && subDispsForPicked.length > 0 && (
                <select
                  value={subDisposition}
                  onChange={(e) => setSubDisposition(e.target.value)}
                  style={{ ...chipInputStyle, maxWidth: 150 }}
                >
                  <option value="">All Subdispositions</option>
                  {subDispsForPicked.map((sd) => (
                    <option key={sd} value={sd}>
                      {sd}
                    </option>
                  ))}
                </select>
              )}

              {/* Date Range */}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ ...chipInputStyle, width: 120 }}
                title="From Date"
              />
              <span style={{ fontSize: 12, color: '#A1A1AA' }}>→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ ...chipInputStyle, width: 120 }}
                title="To Date"
              />

              {/* IQS Range */}
              <input
                type="number"
                placeholder="Min IQS"
                value={iqsMin}
                onChange={(e) => setIqsMin(e.target.value)}
                style={{ ...chipInputStyle, width: 70 }}
              />
              <input
                type="number"
                placeholder="Max IQS"
                value={iqsMax}
                onChange={(e) => setIqsMax(e.target.value)}
                style={{ ...chipInputStyle, width: 70 }}
              />

              {/* CSAT */}
              <select value={csat} onChange={(e) => setCsat(e.target.value)} style={chipInputStyle}>
                <option value="">All CSAT</option>
                <option value="5">Good (5)</option>
                <option value="3">Neutral (3)</option>
                <option value="1">Bad (1)</option>
              </select>

              {/* Quality Param Filter */}
              <select value={qualityParam} onChange={(e) => setQualityParam(e.target.value)} style={{ ...chipInputStyle, maxWidth: 150 }}>
                <option value="">All Param Failures</option>
                {PARAM_LIST.map((p) => (
                  <option key={p.key} value={p.key}>
                    Failed: {p.label}
                  </option>
                ))}
              </select>

              {hasFilters && (
                <button
                  onClick={resetFilters}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    color: '#6B6B6B',
                    fontSize: 12,
                    fontFamily: SANS,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Right Side: Page size icon dropdown + Range in single line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 'auto' }}>
              <span style={{ fontSize: 13, color: '#A1A1AA', whiteSpace: 'nowrap' }}>
                Showing {totalEntries === 0 ? 0 : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, totalEntries)}`} of {totalEntries}
              </span>
              <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                <button
                  title="Rows per page"
                  onClick={() => setOpenPageDrop(openPageDrop === 'tab1' ? null : 'tab1')}
                  style={{
                    width: 28,
                    height: 28,
                    border: '1px solid var(--qa-border, #E4E4E7)',
                    borderRadius: 6,
                    background: 'var(--qa-card, #FFFFFF)',
                    color: 'var(--qa-text-2, #6B6B6B)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                {openPageDrop === 'tab1' && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '100%',
                      marginTop: 4,
                      zIndex: 50,
                      background: 'var(--qa-card, #FFFFFF)',
                      border: '1px solid var(--qa-border, #E4E4E7)',
                      borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      minWidth: 130,
                      overflow: 'hidden',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)' }}>
                      Rows per page
                    </div>
                    {[20, 50, 100].map((n) => (
                      <div
                        key={n}
                        onClick={() => {
                          setPageSize(n);
                          setPage(0);
                          setOpenPageDrop(null);
                        }}
                        style={{
                          padding: '8px 14px',
                          fontSize: 13,
                          cursor: 'pointer',
                          background: pageSize === n ? 'var(--qa-gray-100, #F4F4F5)' : 'transparent',
                          color: 'var(--qa-text, #111111)',
                          fontWeight: pageSize === n ? 600 : 400,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {pageSize === n && <span style={{ fontSize: 10 }}>✓</span>} {n} / page
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Evaluated Chats Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 170 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 85 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH_BASE}>Chat ID</th>
                <th style={TH_BASE}>Agent</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS (Agent)</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                <th style={TH_BASE}>CSAT</th>
                <th style={TH_BASE}>Date</th>
                <th style={TH_BASE}>Dispute</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingEntries ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    Loading evaluated chats…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    No evaluated chats found
                  </td>
                </tr>
              ) : (
                entries.map((e, idx) => {
                  const isOpen = expandedEvalId === e.id;
                  const isLast = idx === entries.length - 1 && !isOpen;
                  const pendingFlag = pendingChatIdMap.get(e.chatId);
                  const reviewedFlag = reviewedChatIdMap.get(e.chatId);

                  return (
                    <Fragment key={e.id}>
                      <tr style={{ background: isOpen ? '#FAFAFB' : '#FFFFFF' }}>
                        <td style={{ ...TD_MONO, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <ChatIdCell chatId={e.chatId} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontWeight: 500 }}>
                          {e.agentName || agentName}
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <IQSBadge score={e.iqs ?? null} />
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <IQSBadge score={e.callIqsScore ?? null} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <CSATBadge score={e.csat ?? null} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 13 }}>
                          {e.date || '—'}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          {pendingFlag ? (
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: '#fefce8',
                                color: '#854d0e',
                                fontWeight: 500,
                              }}
                            >
                              Pending TL Review
                            </span>
                          ) : reviewedFlag ? (
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: '#f0fdf4',
                                color: '#166534',
                                fontWeight: 500,
                              }}
                            >
                              Reviewed
                            </span>
                          ) : (
                            <span style={{ color: '#A1A1AA' }}>—</span>
                          )}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right' }}>
                          <button
                            onClick={() => setExpandedEvalId(isOpen ? null : e.id)}
                            style={{
                              background: 'none',
                              border: 0,
                              fontSize: 13,
                              color: '#111111',
                              fontWeight: 500,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontFamily: SANS,
                            }}
                          >
                            {isOpen ? 'Close' : 'View'}
                            <span
                              style={{
                                color: '#6B6B6B',
                                fontSize: 11,
                                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.15s',
                              }}
                            >
                              ▾
                            </span>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <IRScorePanel
                          key={`panel-${e.id}`}
                          chatId={e.chatId}
                          agentName={e.agentName || agentName}
                          iqsScore={e.iqs}
                          botIqsScore={e.botIqsScore}
                          closedAt={e.date || e.scoredAt || ''}
                          parameters={buildParams(e)}
                          mode="evaluated"
                          flagStatus={pendingFlag?.status}
                          colSpan={8}
                          onClose={() => setExpandedEvalId(null)}
                          onDisputeRaised={() => {
                            fetchDisputes();
                            fetchEvaluatedChats();
                          }}
                        />
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination Footer */}
          {totalEntries > pageSize && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderTop: '1px solid var(--qa-border, #E4E4E7)',
              }}
            >
              <div style={{ fontSize: 13, color: '#6B6B6B' }}>
                Page {page + 1} of {Math.ceil(totalEntries / pageSize)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    cursor: page === 0 ? 'default' : 'pointer',
                    opacity: page === 0 ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  Previous
                </button>
                <button
                  disabled={(page + 1) * pageSize >= totalEntries}
                  onClick={() => setPage((p) => p + 1)}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    cursor: (page + 1) * pageSize >= totalEntries ? 'default' : 'pointer',
                    opacity: (page + 1) * pageSize >= totalEntries ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: DISPUTES RAISED (PENDING) ────────────────────────────────── */}
      {activeTab === 'disputes' && (
        <div style={{ background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Single-line Filter & Pagination Bar */}
          <div
            style={{
              minHeight: 52,
              background: '#FFFFFF',
              borderBottom: '1px solid var(--qa-border, #E4E4E7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 16px',
              overflowX: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <select
                value={pendingOutcomeFilter}
                onChange={(e) => {
                  setPendingOutcomeFilter(e.target.value);
                  setPendingPage(0);
                }}
                style={chipInputStyle}
              >
                <option value="">All Statuses</option>
                <option value="raised_ir">Dispute raised by IR</option>
                <option value="raised_tl">Dispute raised by TL</option>
              </select>

              <input
                type="date"
                value={pendingFromFilter}
                onChange={(e) => {
                  setPendingFromFilter(e.target.value);
                  setPendingPage(0);
                }}
                style={chipInputStyle}
                placeholder="From"
              />
              <input
                type="date"
                value={pendingToFilter}
                onChange={(e) => {
                  setPendingToFilter(e.target.value);
                  setPendingPage(0);
                }}
                style={chipInputStyle}
                placeholder="To"
              />

              {(pendingOutcomeFilter || pendingFromFilter || pendingToFilter) && (
                <button
                  onClick={() => {
                    setPendingOutcomeFilter('');
                    setPendingFromFilter('');
                    setPendingToFilter('');
                    setPendingPage(0);
                  }}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    color: '#6B6B6B',
                    fontSize: 12,
                    fontFamily: SANS,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Right Side: Page size icon dropdown + Range in single line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 'auto' }}>
              <span style={{ fontSize: 13, color: '#A1A1AA', whiteSpace: 'nowrap' }}>
                Showing {filteredPendingDisputes.length === 0 ? 0 : `${pendingPage * pendingPageSize + 1}–${Math.min((pendingPage + 1) * pendingPageSize, filteredPendingDisputes.length)}`} of {filteredPendingDisputes.length}
              </span>
              <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                <button
                  title="Rows per page"
                  onClick={() => setOpenPageDrop(openPageDrop === 'tab2' ? null : 'tab2')}
                  style={{
                    width: 28,
                    height: 28,
                    border: '1px solid var(--qa-border, #E4E4E7)',
                    borderRadius: 6,
                    background: 'var(--qa-card, #FFFFFF)',
                    color: 'var(--qa-text-2, #6B6B6B)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                {openPageDrop === 'tab2' && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '100%',
                      marginTop: 4,
                      zIndex: 50,
                      background: 'var(--qa-card, #FFFFFF)',
                      border: '1px solid var(--qa-border, #E4E4E7)',
                      borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      minWidth: 130,
                      overflow: 'hidden',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)' }}>
                      Rows per page
                    </div>
                    {[20, 50, 100].map((n) => (
                      <div
                        key={n}
                        onClick={() => {
                          setPendingPageSize(n);
                          setPendingPage(0);
                          setOpenPageDrop(null);
                        }}
                        style={{
                          padding: '8px 14px',
                          fontSize: 13,
                          cursor: 'pointer',
                          background: pendingPageSize === n ? 'var(--qa-gray-100, #F4F4F5)' : 'transparent',
                          color: 'var(--qa-text, #111111)',
                          fontWeight: pendingPageSize === n ? 600 : 400,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {pendingPageSize === n && <span style={{ fontSize: 10 }}>✓</span>} {n} / page
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 85 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH_BASE}>Chat ID</th>
                <th style={TH_BASE}>Agent</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS (Agent)</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                <th style={TH_BASE}>CSAT</th>
                <th style={TH_BASE}>Raised Date</th>
                <th style={TH_BASE}>Status</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingPending ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    Loading raised disputes…
                  </td>
                </tr>
              ) : filteredPendingDisputes.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    No pending disputes raised
                  </td>
                </tr>
              ) : (
                filteredPendingDisputes.slice(pendingPage * pendingPageSize, (pendingPage + 1) * pendingPageSize).map((row, idx) => {
                  const isOpen = expandedDisputeId === row.flagId;
                  const isLast = idx === filteredPendingDisputes.slice(pendingPage * pendingPageSize, (pendingPage + 1) * pendingPageSize).length - 1 && !isOpen;
                  const targetInfo = getDisputeClassification(row.challengedParams);
                  const statusText = row.status === 'pending' || row.status === 'ir_pending_tl'
                    ? 'Raised'
                    : row.status === 'tl_forwarded' ? 'Forwarded to QA' : 'Under Review';
                  const dateStr = row.flaggedAt
                    ? new Date(row.flaggedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';

                  return (
                    <Fragment key={row.flagId}>
                      <tr style={{ background: isOpen ? '#FAFAFB' : '#FFFFFF' }}>
                        <td style={{ ...TD_MONO, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <ChatIdCell chatId={row.chatId} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontWeight: 500 }}>
                          {agentName}
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <IQSBadge score={row.iqsScore} />
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <IQSBadge score={row.callIqsScore ?? null} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <CSATBadge score={row.csatScore ?? null} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          {dateStr}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          <DisputeStatusPill
                            status={row.status}
                            raisedByRole={row.raisedByRole}
                            reviewNote={row.reviewNote}
                            parameters={row.parameters}
                          />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {(row.status === 'pending' || row.status === 'ir_pending_tl') && (
                              <button
                                disabled={cancellingId === row.flagId}
                                onClick={() => cancelDispute(row.flagId)}
                                style={{
                                  height: 28,
                                  padding: '0 10px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 500,
                                  background: '#FFFFFF',
                                  border: '1px solid #E4E4E7',
                                  color: '#111111',
                                  cursor: cancellingId === row.flagId ? 'default' : 'pointer',
                                  fontFamily: SANS,
                                  opacity: cancellingId === row.flagId ? 0.5 : 1,
                                }}
                              >
                                {cancellingId === row.flagId ? 'Cancelling…' : 'Cancel'}
                              </button>
                            )}
                            <button
                              onClick={() => setExpandedDisputeId(isOpen ? null : row.flagId)}
                              style={{
                                background: 'none',
                                border: 0,
                                fontSize: 13,
                                color: '#111111',
                                fontWeight: 500,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontFamily: SANS,
                              }}
                            >
                              {isOpen ? 'Close' : 'View'}
                              <span
                                style={{
                                  color: '#6B6B6B',
                                  fontSize: 11,
                                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.15s',
                                }}
                              >
                                ▾
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <>
                          <tr>
                            <td colSpan={8} style={{ padding: '12px 20px', borderBottom: '1px solid #E4E4E7', background: '#FAFAFB' }}>
                              {row.challengedParams.length > 0 && (() => {
                                const targetInfo = getDisputeClassification(row.challengedParams);
                                return (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700,
                                      background: targetInfo.badgeBg, color: targetInfo.badgeText,
                                      border: `1px solid ${targetInfo.badgeBorder}`,
                                      borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', marginRight: 4,
                                    }}>
                                      Target: {targetInfo.label}
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#71717A' }}>Disputed Params</span>
                                    {row.challengedParams.map(cp => (
                                      <span key={cp.param} title={cp.note} style={{
                                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                                        background: '#F4F4F5', border: '1px solid #E4E4E7',
                                        borderRadius: 4, padding: '2px 6px', color: '#52525B', cursor: cp.note ? 'help' : 'default',
                                      }}>{formatParamLabel(cp.param)}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                              <DisputeThread
                                flagId={row.flagId}
                                agentNote={row.agentNote}
                                reviewNote={row.reviewNote}
                                agentName={agentName}
                                reviewedBy={row.reviewedBy}
                                reviewerRole={row.status === 'tl_resolved' ? 'tl' : 'quality'}
                                flaggedAt={row.flaggedAt}
                                reviewedAt={row.reviewedAt}
                                compact
                              />
                            </td>
                          </tr>
                          <IRScorePanel
                            key={`panel-${row.flagId}`}
                            chatId={row.chatId}
                            agentName={agentName}
                            iqsScore={row.iqsScore}
                            botIqsScore={row.botIqsScore}
                            closedAt={row.closedAt}
                            parameters={row.parameters}
                            mode="pending"
                            challengedParams={row.challengedParams}
                            agentNote={row.agentNote}
                            reviewNote={row.reviewNote}
                            flaggedAt={row.flaggedAt}
                            flagId={row.flagId}
                            flagStatus={row.status}
                            colSpan={8}
                            onClose={() => setExpandedDisputeId(null)}
                          />
                        </>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination Footer */}
          {filteredPendingDisputes.length > pendingPageSize && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderTop: '1px solid var(--qa-border, #E4E4E7)',
              }}
            >
              <div style={{ fontSize: 13, color: '#6B6B6B' }}>
                Page {pendingPage + 1} of {Math.max(1, Math.ceil(filteredPendingDisputes.length / pendingPageSize))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={pendingPage === 0}
                  onClick={() => setPendingPage((p) => Math.max(0, p - 1))}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    cursor: pendingPage === 0 ? 'default' : 'pointer',
                    opacity: pendingPage === 0 ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  Previous
                </button>
                <button
                  disabled={(pendingPage + 1) * pendingPageSize >= filteredPendingDisputes.length}
                  onClick={() => setPendingPage((p) => p + 1)}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    cursor: (pendingPage + 1) * pendingPageSize >= filteredPendingDisputes.length ? 'default' : 'pointer',
                    opacity: (pendingPage + 1) * pendingPageSize >= filteredPendingDisputes.length ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: REVIEWED DISPUTES ────────────────────────────────────────── */}
      {activeTab === 'reviewed' && (
        <div style={{ background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Single-line Filter & Pagination Bar */}
          <div
            style={{
              minHeight: 52,
              background: '#FFFFFF',
              borderBottom: '1px solid var(--qa-border, #E4E4E7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 16px',
              overflowX: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <select
                value={reviewedOutcomeFilter}
                onChange={(e) => {
                  setReviewedOutcomeFilter(e.target.value);
                  setReviewedPage(0);
                }}
                style={chipInputStyle}
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
                onChange={(e) => {
                  setReviewedFromFilter(e.target.value);
                  setReviewedPage(0);
                }}
                style={chipInputStyle}
                placeholder="From"
              />
              <input
                type="date"
                value={reviewedToFilter}
                onChange={(e) => {
                  setReviewedToFilter(e.target.value);
                  setReviewedPage(0);
                }}
                style={chipInputStyle}
                placeholder="To"
              />

              {(reviewedOutcomeFilter || reviewedFromFilter || reviewedToFilter) && (
                <button
                  onClick={() => {
                    setReviewedOutcomeFilter('');
                    setReviewedFromFilter('');
                    setReviewedToFilter('');
                    setReviewedPage(0);
                  }}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    color: '#6B6B6B',
                    fontSize: 12,
                    fontFamily: SANS,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Right Side: Page size icon dropdown + Range in single line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 'auto' }}>
              <span style={{ fontSize: 13, color: '#A1A1AA', whiteSpace: 'nowrap' }}>
                Showing {filteredReviewedDisputes.length === 0 ? 0 : `${reviewedPage * reviewedPageSize + 1}–${Math.min((reviewedPage + 1) * reviewedPageSize, filteredReviewedDisputes.length)}`} of {filteredReviewedDisputes.length}
              </span>
              <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                <button
                  title="Rows per page"
                  onClick={() => setOpenPageDrop(openPageDrop === 'tab3' ? null : 'tab3')}
                  style={{
                    width: 28,
                    height: 28,
                    border: '1px solid var(--qa-border, #E4E4E7)',
                    borderRadius: 6,
                    background: 'var(--qa-card, #FFFFFF)',
                    color: 'var(--qa-text-2, #6B6B6B)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                {openPageDrop === 'tab3' && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '100%',
                      marginTop: 4,
                      zIndex: 50,
                      background: 'var(--qa-card, #FFFFFF)',
                      border: '1px solid var(--qa-border, #E4E4E7)',
                      borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      minWidth: 130,
                      overflow: 'hidden',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)' }}>
                      Rows per page
                    </div>
                    {[20, 50, 100].map((n) => (
                      <div
                        key={n}
                        onClick={() => {
                          setReviewedPageSize(n);
                          setReviewedPage(0);
                          setOpenPageDrop(null);
                        }}
                        style={{
                          padding: '8px 14px',
                          fontSize: 13,
                          cursor: 'pointer',
                          background: reviewedPageSize === n ? 'var(--qa-gray-100, #F4F4F5)' : 'transparent',
                          color: 'var(--qa-text, #111111)',
                          fontWeight: reviewedPageSize === n ? 600 : 400,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {reviewedPageSize === n && <span style={{ fontSize: 10 }}>✓</span>} {n} / page
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 85 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH_BASE}>Chat ID</th>
                <th style={TH_BASE}>Agent</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS (Agent)</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Call IQS</th>
                <th style={TH_BASE}>CSAT</th>
                <th style={TH_BASE}>Reviewed Date</th>
                <th style={TH_BASE}>Reviewed By</th>
                <th style={TH_BASE}>Outcome</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingReviewed ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    Loading reviewed disputes…
                  </td>
                </tr>
              ) : filteredReviewedDisputes.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    No reviewed disputes found
                  </td>
                </tr>
              ) : (
                filteredReviewedDisputes.slice(reviewedPage * reviewedPageSize, (reviewedPage + 1) * reviewedPageSize).map((row, idx) => {
                  const isOpen = expandedDisputeId === row.flagId;
                  const isLast = idx === filteredReviewedDisputes.slice(reviewedPage * reviewedPageSize, (reviewedPage + 1) * reviewedPageSize).length - 1 && !isOpen;
                  const targetInfo = getDisputeClassification(row.challengedParams);
                  const isRejected = row.reviewNote?.toLowerCase().includes('reject');
                  const outcomeText = isRejected ? 'Rejected' : 'Accepted';

                  const dateStr = row.reviewedAt
                    ? new Date(row.reviewedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : row.flaggedAt
                    ? new Date(row.flaggedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';

                  return (
                    <Fragment key={row.flagId}>
                      <tr style={{ background: isOpen ? '#FAFAFB' : '#FFFFFF' }}>
                        <td style={{ ...TD_MONO, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <ChatIdCell chatId={row.chatId} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontWeight: 500 }}>
                          {agentName}
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <IQSBadge score={row.iqsScore} />
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <IQSBadge score={row.callIqsScore ?? null} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <CSATBadge score={row.csatScore ?? null} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          {dateStr}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          {row.reviewedBy || 'QA'}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          <DisputeStatusPill
                            status={row.status}
                            raisedByRole={row.raisedByRole}
                            reviewNote={row.reviewNote}
                            parameters={row.parameters}
                          />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right' }}>
                          <button
                            onClick={() => setExpandedDisputeId(isOpen ? null : row.flagId)}
                            style={{
                              background: 'none',
                              border: 0,
                              fontSize: 13,
                              color: '#111111',
                              fontWeight: 500,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontFamily: SANS,
                            }}
                          >
                            {isOpen ? 'Close' : 'View'}
                            <span
                              style={{
                                color: '#6B6B6B',
                                fontSize: 11,
                                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.15s',
                              }}
                            >
                              ▾
                            </span>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <>
                          <tr>
                            <td colSpan={9} style={{ padding: '12px 20px', borderBottom: '1px solid #E4E4E7', background: '#FAFAFB' }}>
                              {row.challengedParams.length > 0 && (() => {
                                const targetInfo = getDisputeClassification(row.challengedParams);
                                return (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700,
                                      background: targetInfo.badgeBg, color: targetInfo.badgeText,
                                      border: `1px solid ${targetInfo.badgeBorder}`,
                                      borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', marginRight: 4,
                                    }}>
                                      Target: {targetInfo.label}
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#71717A' }}>Disputed Params</span>
                                    {row.challengedParams.map(cp => (
                                      <span key={cp.param} title={cp.note} style={{
                                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                                        background: '#F4F4F5', border: '1px solid #E4E4E7',
                                        borderRadius: 4, padding: '2px 6px', color: '#52525B', cursor: cp.note ? 'help' : 'default',
                                      }}>{formatParamLabel(cp.param)}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                              <DisputeThread
                                flagId={row.flagId}
                                agentNote={row.agentNote}
                                reviewNote={row.reviewNote}
                                agentName={agentName}
                                reviewedBy={row.reviewedBy}
                                reviewerRole={row.status === 'tl_resolved' ? 'tl' : 'quality'}
                                flaggedAt={row.flaggedAt}
                                reviewedAt={row.reviewedAt}
                                compact
                              />
                            </td>
                          </tr>
                          <IRScorePanel
                            key={`panel-${row.flagId}`}
                            chatId={row.chatId}
                            agentName={agentName}
                            iqsScore={row.iqsScore}
                            botIqsScore={row.botIqsScore}
                            closedAt={row.closedAt}
                            parameters={row.parameters}
                            mode="reviewed"
                            challengedParams={row.challengedParams}
                            agentNote={row.agentNote}
                            reviewNote={row.reviewNote}
                            reviewedBy={row.reviewedBy}
                            flaggedAt={row.flaggedAt}
                            reviewedAt={row.reviewedAt}
                            flagId={row.flagId}
                            flagStatus={row.status}
                            colSpan={9}
                            onClose={() => setExpandedDisputeId(null)}
                          />
                        </>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination Footer */}
          {filteredReviewedDisputes.length > reviewedPageSize && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderTop: '1px solid var(--qa-border, #E4E4E7)',
              }}
            >
              <div style={{ fontSize: 13, color: '#6B6B6B' }}>
                Page {reviewedPage + 1} of {Math.max(1, Math.ceil(filteredReviewedDisputes.length / reviewedPageSize))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={reviewedPage === 0}
                  onClick={() => setReviewedPage((p) => Math.max(0, p - 1))}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    cursor: reviewedPage === 0 ? 'default' : 'pointer',
                    opacity: reviewedPage === 0 ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  Previous
                </button>
                <button
                  disabled={(reviewedPage + 1) * reviewedPageSize >= filteredReviewedDisputes.length}
                  onClick={() => setReviewedPage((p) => p + 1)}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: '1px solid #E4E4E7',
                    background: '#FFFFFF',
                    cursor: (reviewedPage + 1) * reviewedPageSize >= filteredReviewedDisputes.length ? 'default' : 'pointer',
                    opacity: (reviewedPage + 1) * reviewedPageSize >= filteredReviewedDisputes.length ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildParams(e: IQSScoreEntry): Record<string, any> {
  if (e.parameters && Object.keys(e.parameters).length > 0) {
    return e.parameters;
  }
  const out: Record<string, { score: boolean | number | null; reasoning: string }> = {};
  for (const [k, v] of Object.entries(e.scores || {})) {
    // Keep 0.5 distinct — IRScorePanel renders it as 'Half', not NA.
    out[k] = { score: v === 'Yes' ? true : v === 'No' ? false : v === 'Half' ? 0.5 : null, reasoning: e.reasoning?.[k] || '' };
  }
  return out;
}
