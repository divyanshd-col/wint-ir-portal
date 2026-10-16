'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import PeriodFilter, { DEFAULT_PERIOD, type PeriodState } from './PeriodFilter';
import TicketLinkButton from '@/components/quality/TicketLinkButton';
import ParamScoreRow from '@/components/quality/ParamScoreRow';
import { usePaging, ShowingCount, Pager } from '@/components/quality/TablePaging';
import { periodBounds, intentLabel, disputeLabel } from '@/lib/email/ui';
import {
  DEFAULT_EMAIL_PARAMETERS,
  ParameterScoreValue,
  calculateEmailIQS,
  normalizeParamScoreValue,
} from '@/lib/email/context-builder';
import EmailMessageView, { CustomerSummaryBlock, EmailHistoryPanel } from './EmailContentRenderer';
import { DisputeThread } from '@/components/quality/DisputeThread';

type Tab = 'pending' | 'reviewed' | 'disputes' | 'unscored';

interface EvaluationItem {
  id: number;
  ticket_id: string;
  message_id: string;
  chat_id?: string;
  intent_l1?: string | null;
  customer_email?: string;
  agent_id?: string;
  agent_name?: string;
  sent_at: string;
  customer_message?: string;
  agent_reply_text?: string;
  evaluation_status: 'Pending' | 'In_Batch' | 'Completed' | 'Failed' | 'Skipped';
  review_status?: 'pending' | 'reviewed';
  reviewed_by?: string;
  reviewed_at?: string;
  batch_job_id?: string;
  quality_score?: number;
  compliance_passed?: boolean;
  compliance_issues?: string[];
  parameter_scores?: Record<string, string | number>;
  qa_override_score?: number;
  qa_notes?: string;
  dispute_status?: 'None' | 'Raised' | 'Under_Review' | 'TL_Resolved' | 'Resolved' | 'Rejected';
  dispute_notes?: string;
  flag_id?: string;
  challenged_params?: { param: string; note?: string }[];
  evaluated_at?: string;
  subject_line?: string;
  thread_summary?: any;
  effective_score?: number;
  qa_name?: string;
}

// ─── Design Tokens & Styles (Consistent with ChatEvalTable / EvalPanel) ───────
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
  height: 32,
  padding: '0 10px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--qa-border)',
  borderRadius: 8,
  background: 'var(--qa-card)',
  color: 'var(--qa-text)',
  fontSize: 13,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};


// ─── SVG Score Ring (identical to EvalPanel) ──────────────────────────────────
function ScoreRing({ score: rawScore }: { score: number | null }) {
  const score = rawScore == null ? null : Math.round(Number(rawScore));
  if (score == null) {
    return (
      <svg width="60" height="60" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
        <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-fill-med)" strokeWidth="5" />
        <text x="32" y="33" textAnchor="middle" dominantBaseline="central"
          fontSize="13" fontWeight="700" fill="var(--qa-text-3)" fontFamily={MONO}>
          NIL
        </text>
      </svg>
    );
  }
  const RING_C = 169.6;
  const offset = ((100 - Math.max(0, Math.min(100, score))) / 100 * RING_C).toFixed(1);
  const ringColor = score >= 85 ? 'var(--accent)' : score >= 70 ? '#d97706' : '#dc2626';

  return (
    <svg width="60" height="60" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-fill-med)" strokeWidth="5" />
      <circle
        cx="32" cy="32" r="27" fill="none" stroke={ringColor} strokeWidth="5"
        strokeLinecap="round" strokeDasharray="169.6" strokeDashoffset={offset}
        transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 0.3s' }}
      />
      <text x="32" y="33" textAnchor="middle" dominantBaseline="central"
        fontSize="17" fontWeight="700" fill="var(--qa-text)" fontFamily={MONO}>
        {score}
      </text>
    </svg>
  );
}

// ─── Score Badge (consistent with ChatEvalTable) ──────────────────────────────
function QualityScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>;
  return (
    <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
      {Math.round(Number(score))}
    </span>
  );
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span style={{
      fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600, lineHeight: '18px',
      background: active ? 'rgba(255,255,255,0.2)' : 'var(--qa-gray-100)',
      color: active ? '#fff' : 'var(--qa-text-2)',
    }}>
      {count}
    </span>
  );
}

const KNOWN_QA_MAP: Record<string, string> = {
  'yashvi@wintwealth.com': 'Yashvi Chajjer',
  'dipti@wintwealth.com': 'Dipti',
  'nandani.s@wintwealth.com': 'Nandani',
  'isna.rizvi@wintwealth.com': 'Isna',
  'qa reviewer': 'Yashvi Chajjer',
  'qa': 'Yashvi Chajjer',
};

function formatReviewerName(raw?: string | null): string {
  if (!raw) return '—';
  const clean = raw.trim();
  const lower = clean.toLowerCase();
  if (KNOWN_QA_MAP[lower]) return KNOWN_QA_MAP[lower];
  if (lower.includes('@')) {
    const local = clean.split('@')[0];
    return local.split(/[._-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return clean;
}

// Columns per tab, ordered like the chat tables (ID, Agent, ..., Action).
type Col = 'ticket' | 'agent' | 'intent' | 'iqs' | 'csat' | 'dispute' | 'reviewedBy' | 'reviewedAt' | 'action';
const TAB_COLS: Record<Tab, Col[]> = {
  pending: ['ticket', 'agent', 'intent', 'iqs', 'csat', 'action'],
  reviewed: ['ticket', 'agent', 'intent', 'iqs', 'csat', 'reviewedBy', 'reviewedAt', 'action'],
  disputes: ['ticket', 'agent', 'intent', 'iqs', 'csat', 'dispute', 'action'],
  unscored: ['ticket', 'agent', 'intent', 'action'],
};
const COL_LABEL: Record<Col, string> = { ticket: 'Ticket ID', agent: 'Agent', intent: 'Intent', iqs: 'IQS', csat: 'CSAT', dispute: 'Dispute', reviewedBy: 'Reviewed By', reviewedAt: 'Reviewed At', action: 'Action' };
const COL_WIDTH: Partial<Record<Col, number>> = { ticket: 130, agent: 170, iqs: 90, csat: 80, dispute: 120, reviewedBy: 170, reviewedAt: 130, action: 90 };
const RIGHT: Col[] = ['iqs', 'action'];
type SortCol = 'ticket' | 'agent' | 'iqs';

export default function EmailEvaluationPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'admin' || Boolean((session?.user as any)?.isAdmin);
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [summary, setSummary] = useState<{
    pendingReviewCount?: number;
    reviewedCount?: number;
    activeDisputesCount?: number;
    qaDisputesCount?: number;
    unscoredCount?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('');
  const [availableDispositions, setAvailableDispositions] = useState<string[]>([]);
  const [availableAgents, setAvailableAgents] = useState<string[]>([
    'Aman Sharma',
    'Apoorv',
    'Bhavika',
    'Kriti',
    'Priya Singh',
    'Vedant G',
  ]);
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' } | null>(null);

  // QA action state
  const [overrideScores, setOverrideScores] = useState<Record<string, number>>({});
  const [overrideParams, setOverrideParams] = useState<Record<string, Record<string, ParameterScoreValue>>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [submittingAction, setSubmittingAction] = useState(false);

  const normalizeToggleValue = (val: any): ParameterScoreValue => {
    return normalizeParamScoreValue(val);
  };

  const calculateIQS = (params: Record<string, ParameterScoreValue>): number => {
    return calculateEmailIQS(params);
  };

  const getParamsForItem = (item: EvaluationItem): Record<string, ParameterScoreValue> => {
    if (overrideParams[item.message_id]) {
      return overrideParams[item.message_id];
    }
    const current = item.parameter_scores || {};
    const initial: Record<string, ParameterScoreValue> = {};
    DEFAULT_EMAIL_PARAMETERS.forEach(def => {
      let raw = current[def.key];
      if (raw === undefined && def.aliases) {
        for (const alias of def.aliases) {
          if (current[alias] !== undefined) {
            raw = current[alias];
            break;
          }
        }
      }
      initial[def.key] = normalizeParamScoreValue(raw);
    });
    return initial;
  };

  const handleParamChange = (messageId: string, paramKey: string, val: ParameterScoreValue) => {
    const item = items.find(i => i.message_id === messageId);
    const existing = overrideParams[messageId] || (item ? getParamsForItem(item) : {});
    const updated: Record<string, ParameterScoreValue> = {
      ...existing,
      [paramKey]: val,
    };
    const newIQS = calculateIQS(updated);

    setOverrideParams(prev => ({
      ...prev,
      [messageId]: updated,
    }));
    setOverrideScores(prev => ({
      ...prev,
      [messageId]: newIQS,
    }));
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (agentFilter) params.set('agentName', agentFilter);
      if (dispositionFilter) params.set('disposition', dispositionFilter);
      const { from, to } = periodBounds(period.period, period.customFrom, period.customTo);
      params.set('from', from);
      params.set('to', to);
      params.set('tab', tab);

      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        if (data.summary) {
          setSummary(data.summary);
        }
        if (data.agentBreakdown && data.agentBreakdown.length > 0) {
          const names = data.agentBreakdown.map((a: any) => a.agent_name).filter(Boolean);
          setAvailableAgents(prev => Array.from(new Set([...prev, ...names])).sort());
        }
        if (data.assignedDispositions && Array.isArray(data.assignedDispositions)) {
          setAvailableDispositions(data.assignedDispositions);
        }
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('[email-eval] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [tab, search, agentFilter, dispositionFilter, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Tab switch handler
  const handleTabChange = (nextTab: Tab) => {
    if (nextTab === 'unscored' && !isAdmin) return;
    setTab(nextTab);
    setExpandedId(null);
  };

  useEffect(() => {
    if (!isAdmin && tab === 'unscored') {
      setTab('pending');
    }
  }, [isAdmin, tab]);

  const handleSubmitReview = async (item: EvaluationItem) => {
    const currentParams = getParamsForItem(item);
    const scoreVal = overrideScores[item.message_id] !== undefined
      ? Number(overrideScores[item.message_id])
      : (item.effective_score ?? item.quality_score ?? calculateIQS(currentParams));
    const notes = reviewNotes[item.message_id] ?? item.qa_notes ?? '';

    setSubmittingAction(true);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_review',
          messageId: item.message_id,
          score: Number(scoreVal),
          qaNotes: notes,
          parameterScores: {
            ...currentParams,
            ...((item.parameter_scores as any)?.__reasoning ? { __reasoning: (item.parameter_scores as any).__reasoning } : {}),
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const isFromDisputeSection = tab === 'disputes' || Boolean(data.wasDispute) || item.dispute_status === 'Under_Review';
        setSuccessMessage(
          isFromDisputeSection
            ? `Dispute for Ticket #${item.ticket_id.slice(0, 8)} reviewed and moved to Reviewed!`
            : tab === 'reviewed'
              ? `Review for Ticket #${item.ticket_id.slice(0, 8)} updated successfully!`
              : `Evaluation score for Ticket #${item.ticket_id.slice(0, 8)} submitted and moved to Reviewed!`
        );
        setTimeout(() => setSuccessMessage(null), 4000);
        setOverrideScores(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        setOverrideParams(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        setReviewNotes(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        setExpandedId(null);
        if (isFromDisputeSection && tab !== 'reviewed') {
          setTab('reviewed');
        } else {
          fetchData();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleResolveDispute = async (item: EvaluationItem, decision: 'Resolved' | 'Rejected') => {
    const currentParams = getParamsForItem(item);
    const scoreVal = overrideScores[item.message_id] !== undefined
      ? Number(overrideScores[item.message_id])
      : (item.effective_score ?? item.quality_score ?? calculateIQS(currentParams));
    const qaNoteVal = reviewNotes[item.message_id] !== undefined
      ? reviewNotes[item.message_id]
      : (item.qa_notes || `Dispute marked as ${decision}`);

    setSubmittingAction(true);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_dispute',
          messageId: item.message_id,
          decision,
          notes: qaNoteVal,
          newScore: decision === 'Resolved' ? (scoreVal ? Number(scoreVal) : undefined) : undefined,
          parameterScores: decision === 'Resolved' ? currentParams : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

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
    transition: 'background 0.15s, color 0.15s',
  });

  const hasFilters = Boolean(search || agentFilter || dispositionFilter);
  const cols = TAB_COLS[tab];
  const iqsOf = (i: EvaluationItem) => Number(i.effective_score ?? i.quality_score ?? -1);
  const sortedItems = !sort ? items : [...items].sort((a, b) => {
    const cmp = sort.col === 'iqs' ? iqsOf(a) - iqsOf(b)
      : sort.col === 'agent' ? (a.agent_name ?? '').localeCompare(b.agent_name ?? '')
        : String(a.chat_id ?? a.ticket_id).localeCompare(String(b.chat_id ?? b.ticket_id), undefined, { numeric: true });
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const paging = usePaging(sortedItems, `${tab}|${search}|${agentFilter}|${dispositionFilter}|${period.period}|${period.customFrom}|${period.customTo}|${sort?.col}|${sort?.dir}`);

  const agentOptions = Array.from(new Set([
    ...availableAgents,
    ...items.map(i => i.agent_name).filter(Boolean),
  ])).sort();

  const dispositionOptions = Array.from(new Set([
    ...availableDispositions,
    ...items.map(i => i.intent_l1).filter((d): d is string => Boolean(d)),
  ])).sort();

  return (
    <div>
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Email Evaluation
        </h1>
      </div>

      {/* ── Success Toast Banner ── */}
      {successMessage && (
        <div style={{
          background: '#dcfce7',
          border: '1px solid #86efac',
          color: '#15803d',
          padding: '12px 18px',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          fontWeight: 500,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {successMessage}
        </div>
      )}

      {/* ── Tab Bar (Matching ChatEvaluationPage) ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div style={{
          display: 'flex', gap: 4,
          background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
          borderRadius: 10, padding: 4, width: 'fit-content',
        }}>
          <button style={tabStyle(tab === 'pending')} onClick={() => handleTabChange('pending')}>
            Pending Review
            <CountBadge count={summary?.pendingReviewCount ?? (tab === 'pending' ? items.length : 0)} active={tab === 'pending'} />
          </button>
          <button style={tabStyle(tab === 'disputes')} onClick={() => handleTabChange('disputes')}>
            Disputes
            <CountBadge count={summary?.qaDisputesCount ?? (tab === 'disputes' ? items.length : 0)} active={tab === 'disputes'} />
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => handleTabChange('reviewed')}>
            Reviewed Emails
            <CountBadge count={summary?.reviewedCount ?? (tab === 'reviewed' ? items.length : 0)} active={tab === 'reviewed'} />
          </button>
          {isAdmin && (
            <button style={tabStyle(tab === 'unscored')} onClick={() => handleTabChange('unscored')}>
              Unscored Emails
              <CountBadge count={summary?.unscoredCount ?? (tab === 'unscored' ? items.length : 0)} active={tab === 'unscored'} />
            </button>
          )}
        </div>

        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {/* ── One card: filter bar + table + pager (as in the chat tables) ── */}
      <div style={{
        background: 'var(--qa-card)',
        border: '1px solid var(--qa-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--qa-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
          {/* Search Input */}
          <div style={{ position: 'relative', width: 220 }}>
            <input
              type="text"
              placeholder="Search Ticket, Query…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                height: 32,
                padding: '0 10px 0 30px',
                border: '1px solid var(--qa-border)',
                borderRadius: 8,
                background: 'var(--qa-fill-light)',
                color: 'var(--qa-text)',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--qa-text-3)' }}
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {/* Agent Filter Dropdown */}
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            style={{
              height: 32,
              padding: '0 10px',
              border: '1px solid var(--qa-border)',
              borderRadius: 8,
              background: 'var(--qa-card)',
              color: agentFilter ? 'var(--qa-text)' : 'var(--qa-text-2)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="">All Agents</option>
            {agentOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {/* Disposition Filter Dropdown */}
          <select
            value={dispositionFilter}
            onChange={(e) => setDispositionFilter(e.target.value)}
            style={{
              height: 32,
              padding: '0 10px',
              border: '1px solid var(--qa-border)',
              borderRadius: 8,
              background: 'var(--qa-card)',
              color: dispositionFilter ? 'var(--qa-text)' : 'var(--qa-text-2)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="">{isAdmin ? 'All Dispositions' : 'All My Dispositions'}</option>
            {dispositionOptions.map((disp) => (
              <option key={disp} value={disp}>
                {disp}
              </option>
            ))}
          </select>

          {/* Reset Filters */}
          <button
            disabled={!hasFilters}
            onClick={() => { setSearch(''); setAgentFilter(''); setDispositionFilter(''); }}
            style={{
              ...chip,
              color: hasFilters ? 'var(--qa-text)' : 'var(--qa-text-3)',
              opacity: hasFilters ? 1 : 0.5,
              cursor: hasFilters ? 'pointer' : 'not-allowed',
            }}
          >
            Reset Filters
          </button>

          <div style={{ flex: 1 }} />
          <ShowingCount shown={paging.pageItems.length} total={paging.total} loading={loading} pageSize={paging.pageSize} onPageSize={paging.setPageSize} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              {cols.map(c => <col key={c} style={COL_WIDTH[c] ? { width: COL_WIDTH[c] } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cols.map(c => {
                  const sortable = c === 'ticket' || c === 'agent' || c === 'iqs';
                  return (
                    <th key={c} style={{ ...th, textAlign: RIGHT.includes(c) ? 'right' : 'left' }}>
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => setSort(prev => prev?.col === c ? { col: c as SortCol, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col: c as SortCol, dir: 'desc' })}
                          style={{ all: 'inherit', cursor: 'pointer', padding: 0, height: 'auto', background: 'none', border: 'none', display: 'inline-flex', gap: 4 }}
                        >
                          {COL_LABEL[c]} <span style={{ opacity: sort?.col === c ? 1 : 0.3 }}>{sort?.col === c ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </button>
                      ) : COL_LABEL[c]}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {cols.map((c, j) => (
                      <td key={j} style={td}>
                        <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: '60%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paging.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={cols.length} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '48px 16px' }}>
                    No email reply evaluations found matching filters
                  </td>
                </tr>
              ) : (
                paging.pageItems.map(item => {
                  const isExpanded = expandedId === item.message_id;
                  const itemParams = getParamsForItem(item);
                  const isSessionOverridden = overrideScores[item.message_id] !== undefined;
                  const currentIQS = isSessionOverridden
                    ? Number(overrideScores[item.message_id])
                    : (item.effective_score ?? item.quality_score ?? calculateIQS(itemParams));
                  const hasOverride = item.qa_override_score !== null && item.qa_override_score !== undefined;
                  const cell: Record<Col, React.ReactNode> = {
                    ticket: (
                      <td style={tdMono}>
                        <TicketLinkButton id={item.chat_id ?? item.ticket_id} label={item.chat_id ?? `${item.ticket_id.slice(0, 8)}…`} />
                      </td>
                    ),
                    agent: (
                      <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.agent_name || 'Unassigned'}
                      </td>
                    ),
                    intent: (
                      <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{intentLabel(item.intent_l1)}</td>
                    ),
                    iqs: (
                      <td style={tdNum}>
                        {item.evaluation_status === 'Completed'
                          ? <QualityScoreBadge score={currentIQS} />
                          : <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>}
                      </td>
                    ),
                    csat: <td style={{ ...td, color: 'var(--qa-text-3)' }}>—</td>,
                    dispute: (
                      <td style={{ ...td, fontSize: 13 }}>{disputeLabel(item.dispute_status, item.qa_name || item.reviewed_by)}</td>
                    ),
                    reviewedBy: (
                      <td style={{ ...td, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatReviewerName(item.reviewed_by)}</td>
                    ),
                    reviewedAt: (
                      <td style={{ ...td, fontSize: 13, color: 'var(--qa-text-2)', whiteSpace: 'nowrap' }}>
                        {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                    ),
                    action: (
                      <td style={{ ...td, textAlign: 'right' }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--qa-text-2)' }}>
                          {isExpanded ? 'Hide ▲' : 'Review ▼'}
                        </span>
                      </td>
                    ),
                  };

                  return (
                    <React.Fragment key={item.message_id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : item.message_id)}
                        style={{
                          background: isExpanded ? 'var(--qa-gray-50)' : undefined,
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ''; }}
                      >
                        {cols.map(c => <React.Fragment key={c}>{cell[c]}</React.Fragment>)}
                      </tr>

                      {/* ── Expanded Inline Review Drawer (Matching EvalPanel Structure) ── */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={cols.length} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
                            <div style={{
                              background: 'var(--qa-gray-50)',
                              borderTop: '1px solid var(--qa-border-sub)',
                              padding: '24px 28px',
                              display: 'grid',
                              gridTemplateColumns: '1fr 1.2fr',
                              gap: 28,
                            }}>
                              {/* Left Pane: AI Score Ring, Parameters, Compliance & QA Override Form (evaluation on the left, as in chats) */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                                {/* Top Ring & Score Summary Card */}
                                <div style={{
                                  background: 'var(--qa-card)',
                                  border: '1px solid var(--qa-border)',
                                  borderRadius: 8,
                                  padding: '16px 20px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 20,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    <ScoreRing score={currentIQS} />
                                    <div>
                                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                        IQS
                                      </div>
                                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--qa-text)', marginTop: 2 }}>
                                        {currentIQS != null ? `${Math.round(Number(currentIQS))}%` : 'Pending'}
                                      </div>
                                      {isSessionOverridden && item.quality_score != null ? (
                                        <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600 }}>
                                          Adjusted from {Math.round(Number(item.quality_score))}%
                                        </div>
                                      ) : tab !== 'disputes' && hasOverride && item.quality_score != null ? (
                                        <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600 }}>
                                          QA Override from {Math.round(Number(item.quality_score))}%
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                      Compliance
                                    </div>
                                    <div style={{ marginTop: 4 }}>
                                      {item.compliance_passed === false ? (
                                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
                                          Non-Compliant
                                        </span>
                                      ) : item.compliance_passed === true ? (
                                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
                                          Compliant
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>Pending Eval</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Compliance Issues Banner */}
                                {item.compliance_issues && item.compliance_issues.length > 0 && (
                                  <div style={{
                                    background: '#fff1f2',
                                    border: '1px solid #fecdd3',
                                    borderRadius: 8,
                                    padding: '10px 14px',
                                  }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9f1239', textTransform: 'uppercase' }}>
                                      Compliance Breaches
                                    </div>
                                    <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12, color: '#881337' }}>
                                      {item.compliance_issues.map((iss, idx) => (
                                        <li key={idx}>{iss}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Parameter Scores (Matching EvalPanel in Chats) */}
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                      Parameter Scores ({DEFAULT_EMAIL_PARAMETERS.length})
                                    </div>
                                  </div>

                                  <div style={{
                                    border: '1px solid var(--qa-border)',
                                    borderRadius: 8,
                                    background: 'var(--qa-card)',
                                    overflow: 'hidden',
                                  }}>
                                    {DEFAULT_EMAIL_PARAMETERS.map((def, idx) => {
                                      const currentParams = getParamsForItem(item);
                                      const isDisputed = tab === 'disputes' && (item.challenged_params?.some(cp => cp.param === def.key) ?? false);
                                      return (
                                        <ParamScoreRow
                                          key={def.key}
                                          name={def.name}
                                          description={def.description}
                                          value={currentParams[def.key] ?? 'yes'}
                                          allowNA={def.allowNA}
                                          weight={def.defaultWeight}
                                          disputed={isDisputed}
                                          reason={(item.parameter_scores as any)?.__reasoning?.[def.key]}
                                          onChange={(v) => handleParamChange(item.message_id, def.key, v as ParameterScoreValue)}
                                          last={idx === DEFAULT_EMAIL_PARAMETERS.length - 1}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Action Bar: Submit Review / Update */}
                                <div style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  paddingTop: 6,
                                }}>
                                  <div>
                                    {item.review_status === 'reviewed' && item.reviewed_by && (
                                      <div style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>
                                        Reviewed by <strong>{formatReviewerName(item.reviewed_by)}</strong> {item.reviewed_at ? `on ${new Date(item.reviewed_at).toLocaleDateString('en-GB')}` : ''}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                                    {item.review_status === 'reviewed' ? (
                                      <button
                                        onClick={() => handleSubmitReview(item)}
                                        disabled={submittingAction}
                                        style={{
                                          height: 34,
                                          padding: '0 18px',
                                          border: 'none',
                                          borderRadius: 6,
                                          background: 'var(--qa-gray-700)',
                                          color: '#fff',
                                          fontSize: 12,
                                          fontWeight: 600,
                                          cursor: submittingAction ? 'not-allowed' : 'pointer',
                                          opacity: submittingAction ? 0.7 : 1,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        {submittingAction ? 'Updating…' : 'Update Review'}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleSubmitReview(item)}
                                        disabled={submittingAction}
                                        style={{
                                          height: 36,
                                          padding: '0 20px',
                                          border: 'none',
                                          borderRadius: 8,
                                          background: 'var(--accent, #16a34a)',
                                          color: '#fff',
                                          fontSize: 13,
                                          fontWeight: 600,
                                          cursor: submittingAction ? 'not-allowed' : 'pointer',
                                          opacity: submittingAction ? 0.7 : 1,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                        }}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        {submittingAction ? 'Submitting…' : 'Submit Evaluation Score'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right Pane: Customer Query Context & Agent Outbound Reply (conversation on the right, as in chats) */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                      Customer Context &amp; Query Summary
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setHistoryOpen(prev => ({ ...prev, [item.message_id]: !prev[item.message_id] }))}
                                      style={{
                                        height: 26,
                                        padding: '0 10px',
                                        borderRadius: 6,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: '1px solid var(--qa-border)',
                                        background: historyOpen[item.message_id] ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                                        color: historyOpen[item.message_id] ? '#fff' : 'var(--qa-text-2)',
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
                                      {historyOpen[item.message_id] ? 'Hide History' : 'History'}
                                    </button>
                                  </div>

                                  {/* History Panel */}
                                  {historyOpen[item.message_id] && (
                                    <EmailHistoryPanel
                                      customerEmail={item.customer_email}
                                      chatId={item.chat_id}
                                      ticketId={item.ticket_id}
                                      onClose={() => setHistoryOpen(prev => ({ ...prev, [item.message_id]: false }))}
                                    />
                                  )}

                                  {/* Customer Context / Query: ONLY SUMMARY */}
                                  <div style={{
                                    background: 'var(--qa-card)',
                                    border: '1px solid var(--qa-border)',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                  }}>
                                    <CustomerSummaryBlock
                                      threadSummary={item.thread_summary}
                                      customerMessage={item.customer_message}
                                      subjectLine={item.subject_line}
                                    />
                                  </div>
                                </div>

                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                                    Agent Outbound Reply ({item.agent_name || 'Agent'})
                                  </div>
                                  <div style={{
                                    background: 'var(--qa-card)',
                                    border: '1px solid var(--qa-border)',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                    fontSize: 13,
                                    lineHeight: '1.6',
                                    color: 'var(--qa-text)',
                                    maxHeight: 420,
                                    overflowY: 'auto',
                                  }}>
                                    <EmailMessageView
                                      content={item.agent_reply_text}
                                      fallback="No message content available."
                                    />
                                  </div>
                                </div>

                                {tab === 'disputes' && item.dispute_status && item.dispute_status !== 'None' && (
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
                                      qaName={item.qa_name || item.reviewed_by}
                                      reviewerRole="quality"
                                      flaggedAt={item.sent_at}
                                      reviewedAt={item.reviewed_at}
                                      compact
                                    />
                                  </div>
                                )}
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
    </div>
  );
}
