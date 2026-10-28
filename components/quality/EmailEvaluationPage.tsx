'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { DEFAULT_PERIOD, type PeriodState } from './PeriodFilter';
import DateRangePicker from './DateRangePicker';
import TicketLinkButton from '@/components/quality/TicketLinkButton';
import ParamScoreRow from '@/components/quality/ParamScoreRow';
import { usePaging, ShowingCount, Pager } from '@/components/quality/TablePaging';
import { periodBounds, intentLabel, disputeLabel, formatEmailDateTime } from '@/lib/email/ui';
import {
  DEFAULT_EMAIL_PARAMETERS,
  ParameterScoreValue,
  calculateEmailIQS,
  normalizeParamScoreValue,
} from '@/lib/email/context-builder';
import EmailMessageView, {
  CustomerSummaryBlock,
  CustomerCoreQueryCard,
  CustomerEmailThreadCard,
  EmailHistoryPanel,
  InternalNotesBlock,
  type InternalNote,
} from './EmailContentRenderer';
import { DisputeThread } from '@/components/quality/DisputeThread';
import UISelect from '@/components/quality/UISelect';
import AutoTextarea from './AutoTextarea';

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
  internal_notes?: InternalNote[];
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

const chipActive: React.CSSProperties = {
  ...chip,
  background: 'var(--qa-gray-700)',
  color: '#fff',
  borderColor: 'var(--qa-gray-700)',
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
      background: active ? 'var(--ink)' : 'var(--qa-fill-light)',
      color: active ? 'var(--ink-fg)' : 'var(--qa-text-2)',
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

// Columns per tab, ordered like the chat tables (ID, Date & Time, Agent, ..., Action).
type Col = 'ticket' | 'dateTime' | 'agent' | 'intent' | 'iqs' | 'csat' | 'dispute' | 'reviewedBy' | 'reviewedAt' | 'action';
const TAB_COLS: Record<Tab, Col[]> = {
  pending: ['ticket', 'dateTime', 'agent', 'intent', 'iqs', 'csat', 'action'],
  reviewed: ['ticket', 'dateTime', 'agent', 'intent', 'iqs', 'csat', 'reviewedBy', 'reviewedAt', 'action'],
  disputes: ['ticket', 'dateTime', 'agent', 'intent', 'iqs', 'csat', 'dispute', 'action'],
  unscored: ['ticket', 'dateTime', 'agent', 'intent', 'action'],
};
const COL_LABEL: Record<Col, string> = { ticket: 'Ticket ID', dateTime: 'Date & Time', agent: 'Agent', intent: 'Intent', iqs: 'IQS', csat: 'CSAT', dispute: 'Dispute', reviewedBy: 'Reviewed By', reviewedAt: 'Reviewed At', action: 'Action' };
const COL_WIDTH: Partial<Record<Col, number>> = {};
// Column widths (%) put the ID, date and agent columns on the left of the panel split (57.4%), scores + action on the right.
const TAB_WIDTHS: Record<Tab, number[]> = {
  pending:  [12, 13, 16, 16.4, 14.2, 14.2, 14.2],
  reviewed: [12, 12, 15, 18.4, 8, 8, 11, 8, 7.6],
  disputes: [11, 12, 15, 19.4, 10, 10, 12, 10.6],
  unscored: [14, 14, 22, 34, 16],
};
const RIGHT: Col[] = ['iqs', 'action'];
type SortCol = 'dateTime' | 'agent' | 'intent' | 'iqs' | 'dispute' | 'reviewedBy' | 'reviewedAt';
const SORTABLE: Col[] = ['dateTime', 'agent', 'intent', 'iqs', 'dispute', 'reviewedBy', 'reviewedAt']; // IDs and Action are not sortable; e-mail has no CSAT

export default function EmailEvaluationPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'admin' || Boolean((session?.user as any)?.isAdmin);
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [summary, setSummary] = useState<{
    pendingReviewCount?: number;
    totalPendingReviewCount?: number;
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
  const [showFilterBarPicker, setShowFilterBarPicker] = useState(false);
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' } | null>(null);

  // QA action state
  const [overrideScores, setOverrideScores] = useState<Record<string, number>>({});
  const [overrideParams, setOverrideParams] = useState<Record<string, Record<string, ParameterScoreValue>>>({});
  const [overrideReasoning, setOverrideReasoning] = useState<Record<string, Record<string, string>>>({});
  const [overrideComplianceIssues, setOverrideComplianceIssues] = useState<Record<string, string[]>>({});
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

  const getReasoningForItem = (item: EvaluationItem): Record<string, string> => {
    if (overrideReasoning[item.message_id]) {
      return overrideReasoning[item.message_id];
    }
    const current = (item.parameter_scores as any) || {};
    const existingReasoning = (current.__reasoning && typeof current.__reasoning === 'object') ? current.__reasoning : {};
    const initial: Record<string, string> = { ...existingReasoning };
    DEFAULT_EMAIL_PARAMETERS.forEach(def => {
      if (!initial[def.key] && def.aliases) {
        for (const alias of def.aliases) {
          if (existingReasoning[alias]) {
            initial[def.key] = existingReasoning[alias];
            break;
          }
        }
      }
      if (initial[def.key] === undefined) {
        initial[def.key] = '';
      }
    });
    return initial;
  };

  const handleReasoningChange = (messageId: string, paramKey: string, text: string) => {
    const item = items.find(i => i.message_id === messageId);
    const existing = overrideReasoning[messageId] || (item ? getReasoningForItem(item) : {});
    setOverrideReasoning(prev => ({
      ...prev,
      [messageId]: {
        ...existing,
        [paramKey]: text,
      },
    }));
  };

  const getComplianceIssuesForItem = (item: EvaluationItem): string[] => {
    if (overrideComplianceIssues[item.message_id] !== undefined) {
      return overrideComplianceIssues[item.message_id];
    }
    return item.compliance_issues || [];
  };

  const handleComplianceIssueChange = (messageId: string, index: number, text: string) => {
    const item = items.find(i => i.message_id === messageId);
    const existing = overrideComplianceIssues[messageId] || (item ? getComplianceIssuesForItem(item) : []);
    const updated = [...existing];
    updated[index] = text;
    setOverrideComplianceIssues(prev => ({
      ...prev,
      [messageId]: updated,
    }));
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
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('tab', tab);
      params.set('limit', '500');

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
    const currentReasoning = getReasoningForItem(item);
    const currentComplianceIssues = getComplianceIssuesForItem(item);
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
            ...(Object.keys(currentReasoning).length > 0 ? { __reasoning: currentReasoning } : {}),
          },
          complianceIssues: currentComplianceIssues,
          compliancePassed: currentComplianceIssues.length === 0,
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
        setOverrideReasoning(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        setOverrideComplianceIssues(prev => {
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
    const currentReasoning = getReasoningForItem(item);
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
          parameterScores: decision === 'Resolved' ? {
            ...currentParams,
            ...(Object.keys(currentReasoning).length > 0 ? { __reasoning: currentReasoning } : {}),
          } : undefined,
          complianceIssues: decision === 'Resolved' ? getComplianceIssuesForItem(item) : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
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
        setOverrideReasoning(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        setOverrideComplianceIssues(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        setReviewNotes(prev => {
          const next = { ...prev };
          delete next[item.message_id];
          return next;
        });
        fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 40, padding: '0 14px', border: 'none', borderRadius: 0, marginBottom: -1,
    background: 'transparent',
    color: active ? 'var(--qa-text)' : 'var(--qa-text-2)',
    borderBottom: `2px solid ${active ? 'var(--qa-text)' : 'transparent'}`, whiteSpace: 'nowrap', flexShrink: 0,
    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  const hasFilters = Boolean(search || agentFilter || dispositionFilter || period.period !== 'all');
  const cols = TAB_COLS[tab];
  const iqsOf = (i: EvaluationItem) => Number(i.effective_score ?? i.quality_score ?? -1);
  const sortKey = (i: EvaluationItem, col: SortCol): string | number => {
    switch (col) {
      case 'iqs': return iqsOf(i);
      case 'dateTime': return new Date(i.sent_at || 0).getTime();
      case 'agent': return i.agent_name ?? '';
      case 'intent': return i.intent_l1 ?? '';
      case 'dispute': return i.dispute_status ?? '';
      case 'reviewedBy': return i.reviewed_by ?? '';
      default: return i.reviewed_at ?? '';
    }
  };
  const sortedItems = !sort ? items : [...items].sort((a, b) => {
    const x = sortKey(a, sort.col), y = sortKey(b, sort.col);
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
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
          borderBottom: '1px solid var(--qa-border)', flex: 1, minWidth: 0, overflowX: 'auto',
        }}>
          <button
            style={tabStyle(tab === 'pending')}
            onClick={() => handleTabChange('pending')}
            title={summary?.totalPendingReviewCount ? `Total pending emails: ${summary.totalPendingReviewCount}` : undefined}
          >
            Pending Review
            <CountBadge
              count={
                period.period === 'all'
                  ? (summary?.totalPendingReviewCount ?? summary?.pendingReviewCount ?? (tab === 'pending' ? items.length : 0))
                  : (summary?.pendingReviewCount ?? (tab === 'pending' ? items.length : 0))
              }
              active={tab === 'pending'}
            />
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

      </div>

      {/* ── One card: filter bar + table + pager (as in the chat tables) ── */}
      <div style={{
        background: 'var(--qa-card)',
        border: '1px solid var(--qa-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '8px 16px',
          minHeight: 56,
          background: 'var(--sunk)',
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
              placeholder="Search Ticket, Query, Email…"
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
          <UISelect
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
          </UISelect>

          {/* Disposition Filter Dropdown */}
          <UISelect
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
          </UISelect>

          {/* Date Range Filter Chip */}
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              style={period.period !== 'all' ? chipActive : chip}
              onClick={() => setShowFilterBarPicker((v) => !v)}
              title={
                period.period === 'custom' && period.customFrom && period.customTo
                  ? `${period.customFrom} to ${period.customTo}`
                  : period.period === '7'
                  ? 'Last 7 days'
                  : period.period === '30'
                  ? 'Last 30 days'
                  : 'Filter by date range'
              }
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: 0.8 }}
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {period.period === 'custom' && period.customFrom && period.customTo
                ? `${period.customFrom} – ${period.customTo}`
                : period.period === '7'
                ? 'Last 7 days'
                : period.period === '30'
                ? 'Last 30 days'
                : 'Date range'}
              <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
            </button>
            {showFilterBarPicker && (
              <DateRangePicker
                onApply={(from, to) => {
                  setPeriod({ period: 'custom', customFrom: from, customTo: to });
                  setShowFilterBarPicker(false);
                }}
                onCancel={() => setShowFilterBarPicker(false)}
              />
            )}
          </div>

          {/* Reset Filters */}
          <button
            disabled={!hasFilters}
            onClick={() => {
              setSearch('');
              setAgentFilter('');
              setDispositionFilter('');
              setPeriod({ period: 'all' });
            }}
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
              {cols.map((c, i) => <col key={c} style={{ width: `${TAB_WIDTHS[tab][i]}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                {cols.map(c => {
                  const sortable = SORTABLE.includes(c);
                  return (
                    <th key={c} style={{ ...th, textAlign: RIGHT.includes(c) ? 'right' : 'left' }}>
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => setSort(prev => prev?.col === c ? { col: c as SortCol, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col: c as SortCol, dir: 'asc' })}
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
                    dateTime: (() => {
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
                    })(),
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
                          background: isExpanded ? 'var(--accent-weak)' : undefined,
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ''; }}
                      >
                        {cols.map(c => <React.Fragment key={c}>{cell[c]}</React.Fragment>)}
                      </tr>

                      {/* ── Expanded inline review: conversation left, scoring right (same layout as chat and call evaluation) ── */}
                      {isExpanded && (
                        <tr className="eval-panel-row">
                          <td colSpan={cols.length} className="eval-panel-cell" style={{ padding: 0, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)' }}>
                            <div className="eval-wrap" style={{ width: '100%', maxWidth: '100%', margin: '16px auto', boxSizing: 'border-box', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)' }}>
                              {/* Conversation */}
                              <div className="eval-pane">
                                <div style={{ height: 52, padding: '0 12px', borderBottom: '1px solid var(--qa-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)', flexShrink: 0 }}>Conversation</span>
                                  <TicketLinkButton id={item.chat_id ?? item.ticket_id} label={item.chat_id ?? `${item.ticket_id.slice(0, 8)}…`} />
                                  <div style={{ flex: 1 }} />
                                  <button
                                    type="button"
                                    onClick={() => setHistoryOpen(prev => ({ ...prev, [item.message_id]: !prev[item.message_id] }))}
                                    style={{
                                      height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
                                      background: historyOpen[item.message_id] ? 'var(--ink)' : 'var(--qa-card)',
                                      color: historyOpen[item.message_id] ? 'var(--ink-fg)' : 'var(--qa-text-2)',
                                      cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
                                    }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v4H3z" /><path d="M3 9h18v4H3z" /><path d="M3 15h10v4H3z" /></svg>
                                    {historyOpen[item.message_id] ? 'Hide History' : 'History'}
                                  </button>
                                </div>
                                <div className="eval-scroll-t" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                  {/* History Panel */}
                                {historyOpen[item.message_id] && (
                                  <EmailHistoryPanel
                                    customerEmail={item.customer_email}
                                    chatId={item.chat_id}
                                    ticketId={item.ticket_id}
                                    currentMessageId={item.message_id}
                                    onClose={() => setHistoryOpen(prev => ({ ...prev, [item.message_id]: false }))}
                                  />
                                )}


                                {/* 1. Customer Core Query (Separate, prominent, well-spaced) */}
                                <CustomerCoreQueryCard
                                  threadSummary={item.thread_summary}
                                  customerMessage={item.customer_message}
                                  subjectLine={item.subject_line}
                                  customerEmail={item.customer_email}
                                  parameterScores={item.parameter_scores}
                                />


                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                                      Customer Inbound Email Thread
                                    </div>
                                  <CustomerEmailThreadCard
                                    customerMessage={item.customer_message}
                                    subjectLine={item.subject_line}
                                    customerEmail={item.customer_email}
                                  />

                                  </div>

                                {/* Internal Working Notes (highlighted amber, matching chat style) */}
                                {item.internal_notes && item.internal_notes.length > 0 && (
                                  <InternalNotesBlock notes={item.internal_notes} />
                                )}

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

                              {/* Scoring */}
                              <div className="eval-pane">
                                <div style={{ padding: 16, borderBottom: '1px solid var(--qa-border)', flexShrink: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    <ScoreRing score={currentIQS != null ? Math.round(Number(currentIQS)) : null} />
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 600 }}>{item.agent_name || 'Unassigned'}</div>
                                      <div style={{ fontSize: 12, color: 'var(--qa-text-3)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0 8px' }}>
                                        <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--qa-text-2)' }}>{item.chat_id ?? `${item.ticket_id.slice(0, 8)}…`}</span>
                                        {item.sent_at && (<><span>·</span><span>{new Date(item.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></>)}
                                        {intentLabel(item.intent_l1) !== '—' && (<><span>·</span><span>{intentLabel(item.intent_l1)}</span></>)}
                                      </div>
                                      {isSessionOverridden && item.quality_score != null ? (
                                        <div style={{ fontSize: 11, color: 'var(--qa-text-2)', marginTop: 2 }}>Adjusted from {Math.round(Number(item.quality_score))}%</div>
                                      ) : tab !== 'disputes' && hasOverride && item.quality_score != null ? (
                                        <div style={{ fontSize: 11, color: 'var(--qa-text-2)', marginTop: 2 }}>QA override from {Math.round(Number(item.quality_score))}%</div>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button" onClick={() => setExpandedId(null)} aria-label="Close evaluation" title="Close"
                                      style={{
                                        marginLeft: 'auto', alignSelf: 'flex-start', flexShrink: 0,
                                        width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 8,
                                        background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                    </button>
                                  </div>
                                </div>

                                <div className="eval-scroll-r" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                                {/* Compliance Issues Banner with editable reasons */}
                                {(() => {
                                  const issues = getComplianceIssuesForItem(item);
                                  if (!issues || issues.length === 0) return null;
                                  return (
                                    <div style={{
                                      background: 'var(--fail-soft)',
                                      border: '1px solid var(--fail)',
                                      borderRadius: 8,
                                      padding: '10px 14px',
                                      margin: '16px 16px 0',
                                    }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)', textTransform: 'uppercase', marginBottom: 6 }}>
                                        Reason for Compliance Breach:
                                      </div>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {issues.map((iss, idx) => (
                                          <AutoTextarea
                                            key={idx}
                                            value={iss}
                                            onChange={e => handleComplianceIssueChange(item.message_id, idx, e.target.value)}
                                            placeholder="Specify reason / citation for this compliance breach…"
                                            rows={2}
                                            style={{
                                              width: '100%',
                                              boxSizing: 'border-box',
                                              resize: 'vertical',
                                              border: '1px solid var(--fail)',
                                              borderRadius: 6,
                                              padding: '6px 8px',
                                              fontSize: 12.5,
                                              color: 'var(--qa-text)',
                                              lineHeight: 1.45,
                                              fontFamily: 'inherit',
                                              background: 'var(--qa-card)',
                                              outline: 'none',
                                            }}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })()}
                                  <div style={{ padding: 16 }}>
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
                                      const currentReasoning = getReasoningForItem(item);
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
                                          reason={currentReasoning[def.key] ?? ''}
                                          onChange={(v) => handleParamChange(item.message_id, def.key, v as ParameterScoreValue)}
                                          onReasonChange={(r) => handleReasoningChange(item.message_id, def.key, r)}
                                          last={idx === DEFAULT_EMAIL_PARAMETERS.length - 1}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                                  </div>
                                </div>

                                {/* Sticky commit footer: score, compliance, submit */}
                                <div className={`eval-foot${item.compliance_passed === false ? ' failed' : ''}`}>
                                  <div className="eval-status">
                                    <div className="eval-big">
                                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>IQS {currentIQS != null ? `${Math.round(Number(currentIQS))}%` : '—'}</span>
                                      {item.compliance_passed !== null && item.compliance_passed !== undefined && (
                                        <span className={`eval-chip ${item.compliance_passed === false ? 'fail' : 'pass'}`}>{item.compliance_passed === false ? 'NON-COMPLIANT' : 'COMPLIANT'}</span>
                                      )}
                                    </div>
                                    <div className="eval-small">
                                      {item.review_status === 'reviewed' && item.reviewed_by
                                        ? <>Reviewed by {formatReviewerName(item.reviewed_by)}{item.reviewed_at ? ` on ${new Date(item.reviewed_at).toLocaleDateString('en-GB')}` : ''}</>
                                        : 'Check the score before you submit'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className={`eval-submit${item.compliance_passed === false ? ' danger' : ''}`}
                                    onClick={() => handleSubmitReview(item)}
                                    disabled={submittingAction}
                                  >
                                    {submittingAction ? (item.review_status === 'reviewed' ? 'Updating…' : 'Submitting…') : item.review_status === 'reviewed' ? 'Update Review' : 'Submit Evaluation Score'}
                                  </button>
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
    </div>
  );
}
