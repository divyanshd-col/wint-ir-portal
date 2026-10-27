'use client';

import React, { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { DEFAULT_PERIOD, type PeriodState } from '@/components/quality/PeriodFilter';
import { PeriodRangeChip } from '@/components/quality/FilterControls';
import TicketLinkButton from '@/components/quality/TicketLinkButton';
import { usePaging, ShowingCount, Pager } from '@/components/quality/TablePaging';
import ScoreRing from '@/components/quality/ScoreRing';
import ParamScoreRow from '@/components/quality/ParamScoreRow';
import { periodBounds, intentLabel, disputeLabel } from '@/lib/email/ui';
import type { CSSProperties } from 'react';
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
import { rowClick } from '@/components/quality/rowClick';

interface EvaluationItem {
  id: number;
  ticket_id: string;
  message_id: string;
  chat_id?: string;
  intent_l1?: string | null;
  customer_email?: string;
  agent_name: string;
  sent_at: string;
  customer_message?: string;
  agent_reply_text?: string;
  quality_score?: number;
  qa_override_score?: number;
  effective_score?: number;
  compliance_passed?: boolean;
  compliance_issues?: string[];
  parameter_scores?: Record<string, any>;
  qa_notes?: string;
  dispute_status?: 'None' | 'Raised' | 'Under_Review' | 'TL_Resolved' | 'Resolved' | 'Rejected';
  dispute_notes?: string;
  flag_id?: string;
  challenged_params?: { param: string; note?: string }[];
  reviewed_by?: string;
  reviewed_at?: string;
  subject_line?: string;
  thread_summary?: any;
  internal_notes?: InternalNote[];
}

interface SummaryStats {
  totalCount: number;
  completedCount: number;
  avgScore: number;
  complianceBreachCount: number;
  activeDisputesCount: number;
  qaOverridesCount: number;
}

// ─── Shared UI Tokens & Styles (Consistent with MyQualityChatsPage) ───────────

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

const TH_BASE: CSSProperties = {
  height: 40,
  background: 'var(--qa-gray-50, var(--qa-gray-50))',
  borderBottom: '1px solid var(--qa-border, var(--qa-border))',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--qa-text-2, var(--qa-text-2))',
  fontWeight: 500,
  padding: '0 16px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const TD_BASE: CSSProperties = {
  height: 52,
  padding: '0 16px',
  borderBottom: '1px solid var(--qa-border-sub, var(--qa-border-sub))',
  fontSize: 14,
  color: 'var(--qa-text, #111111)',
  verticalAlign: 'middle',
};

const TD_MONO: CSSProperties = {
  ...TD_BASE,
  fontFamily: MONO,
  fontSize: 13,
  color: 'var(--qa-text-2, var(--qa-text-2))',
};

const TD_NUM: CSSProperties = {
  ...TD_BASE,
  textAlign: 'right',
  fontFamily: MONO,
  fontSize: 13,
};

// ─── Badges (Exact match with MyQualityChatsPage) ─────────────────────────────

function IQSBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3, var(--qa-text-3))', fontSize: 13, fontWeight: 500 }}>NIL</span>;
  return <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--qa-text, #111111)' }}>{Math.round(Number(score))}</span>;
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
        background: active ? 'var(--ink)' : 'var(--qa-fill-light)',
        color: active ? 'var(--ink-fg)' : 'var(--qa-text-2, var(--qa-text-2))',
      }}
    >
      {count}
    </span>
  );
}

export default function MyQualityEmailsPage({ agentName }: { agentName: string }) {
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'evaluated' | 'disputes' | 'reviewed'>('evaluated');

  // Filters
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const [search, setSearch] = useState('');
  const [complianceFilter, setComplianceFilter] = useState<'' | 'compliant' | 'breach'>('');

  // Dispute state
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set());
  const [disputeNotes, setDisputeNotes] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeSuccessMsg, setDisputeSuccessMsg] = useState<string | null>(null);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  const fetchMyEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agentName) params.set('agentName', agentName);
      params.set('status', 'Completed');
      const { from, to } = periodBounds(period.period, period.customFrom, period.customTo);
      params.set('from', from);
      params.set('to', to);
      params.set('limit', '500');

      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setSummary(data.summary || null);
      }
    } catch (err) {
      console.error('Failed to load my email evaluations:', err);
    } finally {
      setLoading(false);
    }
  }, [agentName, period]);

  useEffect(() => {
    fetchMyEvaluations();
  }, [fetchMyEvaluations]);

  const toggleParamPick = (paramKey: string) => {
    setSelectedParams(prev => {
      const next = new Set(prev);
      if (next.has(paramKey)) next.delete(paramKey);
      else next.add(paramKey);
      return next;
    });
  };

  const startDispute = (item: EvaluationItem) => {
    setDisputingId(item.message_id);
    setSelectedParams(new Set());
    setDisputeNotes('');
    setDisputeSuccessMsg(null);
    setDisputeError(null);
  };

  const cancelDisputeComposition = () => {
    setDisputingId(null);
    setSelectedParams(new Set());
    setDisputeNotes('');
    setDisputeError(null);
  };

  const handleRaiseDispute = async (messageId: string) => {
    if (!disputeNotes.trim()) {
      setDisputeError('Please enter a reason for the dispute.');
      return;
    }
    if (selectedParams.size === 0) {
      setDisputeError('Please select at least one parameter to challenge.');
      return;
    }
    setSubmittingDispute(true);
    setDisputeError(null);
    try {
      const challenged = Array.from(selectedParams).map(p => ({
        param: p,
        note: disputeNotes.trim(),
      }));
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'raise_dispute',
          messageId,
          notes: disputeNotes.trim(),
          challengedParams: challenged,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDisputeSuccessMsg('Dispute raised successfully. Team Lead and QA have been notified.');
        setDisputingId(null);
        setSelectedParams(new Set());
        setDisputeNotes('');
        fetchMyEvaluations();
      } else {
        setDisputeError(data.error || 'Failed to raise dispute.');
      }
    } catch (e: any) {
      setDisputeError(e?.message || 'Failed to raise dispute.');
    } finally {
      setSubmittingDispute(false);
    }
  };

  const handleCancelDispute = async (messageId: string) => {
    if (!confirm('Are you sure you want to cancel and withdraw this dispute?')) return;
    setSubmittingDispute(true);
    setDisputeError(null);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_dispute',
          messageId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDisputeSuccessMsg('Dispute cancelled.');
        fetchMyEvaluations();
      } else {
        setDisputeError(data.error || 'Failed to cancel dispute.');
      }
    } catch (e: any) {
      setDisputeError(e?.message || 'Failed to cancel dispute.');
    } finally {
      setSubmittingDispute(false);
    }
  };

  // Tab filtering
  const evaluatedItems = useMemo(() => {
    return items;
  }, [items]);

  const disputesRaisedItems = useMemo(() => {
    return items.filter(
      (item) => item.dispute_status === 'Raised' || item.dispute_status === 'Under_Review'
    );
  }, [items]);

  const reviewedDisputesItems = useMemo(() => {
    return items.filter(
      (item) => item.dispute_status === 'Resolved' || item.dispute_status === 'Rejected' || item.dispute_status === 'TL_Resolved'
    );
  }, [items]);

  const currentTabItems = useMemo(() => {
    let source = evaluatedItems;
    if (activeTab === 'disputes') source = disputesRaisedItems;
    else if (activeTab === 'reviewed') source = reviewedDisputesItems;

    return source.filter((item) => {
      if (search) {
        const s = search.toLowerCase();
        const matchTicket = item.ticket_id?.toLowerCase().includes(s);
        const matchSub = item.subject_line?.toLowerCase().includes(s);
        const matchReply = item.agent_reply_text?.toLowerCase().includes(s);
        const matchEmail = item.customer_email?.toLowerCase().includes(s);
        if (!matchTicket && !matchSub && !matchReply && !matchEmail) return false;
      }
      if (complianceFilter === 'compliant' && item.compliance_passed === false) return false;
      if (complianceFilter === 'breach' && item.compliance_passed !== false) return false;
      return true;
    });
  }, [activeTab, evaluatedItems, disputesRaisedItems, reviewedDisputesItems, search, complianceFilter]);

  const paging = usePaging(currentTabItems, `${activeTab}|${search}|${complianceFilter}|${period.period}|${period.customFrom}|${period.customTo}`);
  const hasFilters = Boolean(search || complianceFilter);
  const clearFilters = () => {
    setSearch('');
    setComplianceFilter('');
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 40, padding: '0 14px', border: 'none', borderRadius: 0, marginBottom: -1,
    background: 'transparent',
    color: active ? 'var(--qa-text)' : 'var(--qa-text-2)',
    borderBottom: `2px solid ${active ? 'var(--qa-text)' : 'transparent'}`, whiteSpace: 'nowrap', flexShrink: 0,
    fontFamily: SANS, fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  const chipInputStyle: CSSProperties = {
    height: 32,
    padding: '0 10px',
    border: '1px solid var(--qa-border, var(--qa-border))',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: SANS,
    background: 'var(--qa-card, #FFFFFF)',
    color: 'var(--qa-text, #111111)',
    outline: 'none',
  };

  return (
    <div style={{ fontFamily: SANS, WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>
          My Quality Emails
        </h1>
      </div>

      {/* ── Tabs & Interaction Bar (Exact match with MyQualityChatsPage) ── */}
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
            borderBottom: '1px solid var(--qa-border)', flex: 1, minWidth: 0, overflowX: 'auto',
          }}
        >
          <button style={tabStyle(activeTab === 'evaluated')} onClick={() => setActiveTab('evaluated')}>
            Evaluated Emails
            <CountBadge count={evaluatedItems.length} active={activeTab === 'evaluated'} />
          </button>
          <button style={tabStyle(activeTab === 'disputes')} onClick={() => setActiveTab('disputes')}>
            Disputes Raised
            <CountBadge count={disputesRaisedItems.length} active={activeTab === 'disputes'} />
          </button>
          <button style={tabStyle(activeTab === 'reviewed')} onClick={() => setActiveTab('reviewed')}>
            Reviewed Disputes
            <CountBadge count={reviewedDisputesItems.length} active={activeTab === 'reviewed'} />
          </button>
        </div>

      </div>

      {/* ── KPI Cards (Evaluated tab, between the tabs and the table) ── */}
      {activeTab === 'evaluated' && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, var(--qa-border))',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, var(--qa-text-2))', fontWeight: 500 }}>
              My Quality Average
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--qa-text)', marginTop: 6, fontFamily: MONO }}>
              {summary.avgScore ? `${summary.avgScore}%` : 'N/A'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, var(--qa-text-2))', marginTop: 4 }}>
              Target: 85%+
            </div>
          </div>

          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, var(--qa-border))',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, var(--qa-text-2))', fontWeight: 500 }}>
              Evaluated Replies
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--qa-text)', marginTop: 6, fontFamily: MONO }}>
              {summary.completedCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, var(--qa-text-2))', marginTop: 4 }}>
              Batch processed
            </div>
          </div>

          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, var(--qa-border))',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, var(--qa-text-2))', fontWeight: 500 }}>
              Compliance Rate
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#166534', marginTop: 6, fontFamily: MONO }}>
              {summary.completedCount > 0
                ? `${Math.round(((summary.completedCount - summary.complianceBreachCount) / summary.completedCount) * 100)}%`
                : '100%'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, var(--qa-text-2))', marginTop: 4 }}>
              Zero regulatory breaches
            </div>
          </div>

          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, var(--qa-border))',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, var(--qa-text-2))', fontWeight: 500 }}>
              Active Disputes
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#6b21a8', marginTop: 6, fontFamily: MONO }}>
              {summary.activeDisputesCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, var(--qa-text-2))', marginTop: 4 }}>
              Awaiting QA arbitration
            </div>
          </div>
        </div>
      )}


      {/* ── Table Container Card ── */}
      <div
        style={{
          background: 'var(--qa-card, #FFFFFF)',
          border: '1px solid var(--qa-border, var(--qa-border))',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Single-line Filter Bar */}
        <div className="qfilters">
          {/* Filter Inputs Group */}
          <div style={{ display: 'contents' }}>
            {/* Search */}
            <input
              type="text"
              placeholder="Search Ticket, Subject, Email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...chipInputStyle, width: 230 }}
            />

            {/* Compliance Filter */}
            <select
              value={complianceFilter}
              onChange={(e) => setComplianceFilter(e.target.value as any)}
              style={chipInputStyle}
            >
              <option value="">All Compliance</option>
              <option value="compliant">Compliant</option>
              <option value="breach">Non-Compliant</option>
            </select>

            <PeriodRangeChip value={period} onChange={setPeriod} />

            <button type="button" className="qf-chip" disabled={!(hasFilters || period.period !== 'all')}
                onClick={() => { clearFilters(); setPeriod(DEFAULT_PERIOD); }}
              >
              Reset Filters
            </button>
          </div>

          {/* Records Counter */}
          <div style={{ marginLeft: 'auto' }}>
            <ShowingCount shown={paging.pageItems.length} total={paging.total} loading={loading} pageSize={paging.pageSize} onPageSize={paging.setPageSize} />
          </div>
        </div>

        {/* Data Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 95 }} />
              <col style={{ width: 80 }} />
              {activeTab !== 'evaluated' && <col style={{ width: 150 }} />}
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH_BASE}>Ticket ID</th>
                <th style={TH_BASE}>Agent</th>
                <th style={TH_BASE}>Intent</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS</th>
                <th style={TH_BASE}>CSAT</th>
                {activeTab !== 'evaluated' && <th style={TH_BASE}>{activeTab === 'reviewed' ? 'Outcome' : 'Dispute'}</th>}
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={activeTab === 'evaluated' ? 6 : 7} style={{ textAlign: 'center', color: 'var(--qa-text-3)', fontSize: 13, padding: '36px 0' }}>
                    Loading email quality evaluations…
                  </td>
                </tr>
              ) : currentTabItems.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'evaluated' ? 6 : 7} style={{ textAlign: 'center', color: 'var(--qa-text-3)', fontSize: 13, padding: '36px 0' }}>
                    No evaluations found in this view.
                  </td>
                </tr>
              ) : (
                paging.pageItems.map((item, idx) => {
                  const isOpen = expandedId === item.message_id;
                  const isLast = idx === paging.pageItems.length - 1 && !isOpen;
                  const score = item.effective_score ?? item.quality_score ?? null;
                  const isOverridden = item.qa_override_score !== null && item.qa_override_score !== undefined;
                  const isDisputed = item.dispute_status && item.dispute_status !== 'None';
                  const isReviewedDispute = item.dispute_status === 'Resolved' || item.dispute_status === 'Rejected' || item.dispute_status === 'TL_Resolved';

                  return (
                    <Fragment key={item.message_id}>
                      <tr data-row-click onClick={rowClick(() => { setExpandedId(isOpen ? null : item.message_id); setDisputeSuccessMsg(null); })}
                        style={{
                          background: isOpen ? 'var(--accent-weak)' : '#FFFFFF',
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ ...TD_MONO, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)' }}>
                          <TicketLinkButton id={item.chat_id ?? item.ticket_id} label={item.chat_id ?? `${item.ticket_id.slice(0, 12)}…`} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.agent_name || agentName}</td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--qa-text, #111111)' }}>{intentLabel(item.intent_l1)}</span>
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)' }}>
                          <IQSBadge score={score} />
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)', color: 'var(--qa-text-3, var(--qa-text-3))' }}>—</td>
                        {activeTab !== 'evaluated' && (
                          <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)', fontSize: 13 }}>
                            {isDisputed ? disputeLabel(item.dispute_status) : <span style={{ color: 'var(--qa-text-3, var(--qa-text-3))' }}>—</span>}
                          </td>
                        )}
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub)', textAlign: 'right' }}>
                          <button
                            onClick={() => {
                              setExpandedId(isOpen ? null : item.message_id);
                              setDisputeSuccessMsg(null);
                            }}
                            style={{
                              background: 'none',
                              border: 0,
                              fontSize: 13,
                              color: 'var(--qa-text)',
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
                                color: 'var(--qa-text-2)',
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

                      {/* ── Expanded Detail Drawer (Exact match with IRScorePanel) ── */}
                      {isOpen && (
                        <tr style={{ background: 'var(--qa-gray-50)' }}>
                          <td colSpan={activeTab === 'evaluated' ? 6 : 7} style={{ padding: '0 16px 16px' }}>
                            <div
                              style={{
                                display: 'flex',
                                border: '1px solid var(--qa-border)',
                                borderRadius: 8,
                                background: '#FFFFFF',
                                overflow: 'hidden',
                                minHeight: 460,
                              }}
                            >
                              {/* ── Left Pane: Score Ring, Parameters, & QA Notes ── */}
                              <div
                                style={{
                                  width: 480,
                                  minWidth: 400,
                                  flexShrink: 0,
                                  borderRight: '1px solid var(--qa-border)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                }}
                              >
                                {/* Header */}
                                <div style={{ padding: 16, borderBottom: '1px solid var(--qa-border)', flexShrink: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    <ScoreRing score={score} />
                                    <div>
                                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>
                                        {item.agent_name || agentName}
                                      </div>
                                      <div style={{ fontSize: 12, color: 'var(--qa-text-3)', marginTop: 4 }}>
                                        <span style={{ fontFamily: MONO }}>{item.ticket_id}</span>
                                        {' · '}
                                        {new Date(item.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                      </div>
                                      {isOverridden && (
                                        <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600, marginTop: 4 }}>
                                          Adjusted from {Math.round(Number(item.quality_score))}%
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Section Header */}
                                <div
                                  style={{
                                    padding: '10px 16px',
                                    borderBottom: '1px solid var(--qa-border)',
                                    background: 'var(--qa-gray-50)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: 'var(--qa-text-2, var(--qa-text-2))',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                >
                                  <span>Parameter Scores ({DEFAULT_EMAIL_PARAMETERS.length})</span>
                                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--qa-text-3)' }}>IQS Breakdown</span>
                                </div>

                                {/* Parameters List */}
                                <div style={{ flex: 1, overflowY: 'auto' }}>
                                  {DEFAULT_EMAIL_PARAMETERS.map((def, pIdx) => {
                                    const val = [def.key, ...(def.aliases ?? [])].map(k => item.parameter_scores?.[k]).find(v => v !== undefined);
                                    const isChallenged = item.challenged_params?.some(cp => cp.param === def.key);
                                    const isPicked = disputingId === item.message_id && selectedParams.has(def.key);

                                    return (
                                      <div
                                        key={def.key}
                                        onClick={disputingId === item.message_id ? () => toggleParamPick(def.key) : undefined}
                                        style={{
                                          cursor: disputingId === item.message_id ? 'pointer' : 'default',
                                          background: isPicked ? 'var(--qa-fill-light, var(--qa-gray-50))' : 'transparent',
                                          boxShadow: isPicked ? 'inset 3px 0 0 var(--qa-gray-700, #111111)' : 'none',
                                          transition: 'background 0.1s',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 16px 0', gap: 6 }}>
                                          {disputingId === item.message_id && (
                                            <input
                                              type="checkbox"
                                              checked={isPicked}
                                              onChange={() => toggleParamPick(def.key)}
                                              onClick={e => e.stopPropagation()}
                                              style={{ cursor: 'pointer', width: 15, height: 15, accentColor: '#111111' }}
                                            />
                                          )}
                                          {isChallenged && (
                                            <span style={{
                                              height: 18, padding: '0 7px', borderRadius: 999,
                                              background: 'var(--qa-gray-700, #2D2D31)', color: '#fff',
                                              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                                              display: 'inline-flex', alignItems: 'center',
                                            }}>
                                              Disputed
                                            </span>
                                          )}
                                        </div>
                                        <ParamScoreRow
                                          name={def.name}
                                          description={def.description}
                                          value={val}
                                          allowNA={def.allowNA}
                                          weight={def.defaultWeight}
                                          reason={(item.parameter_scores as any)?.__reasoning?.[def.key]}
                                          last={pIdx === DEFAULT_EMAIL_PARAMETERS.length - 1}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* ── Right Pane: Customer Email, Agent Reply & Dispute Box ── */}
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                {/* Header */}
                                <div
                                  style={{
                                    padding: '12px 16px',
                                    borderBottom: '1px solid var(--qa-border)',
                                    background: 'var(--qa-gray-50)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: 'var(--qa-text-2, var(--qa-text-2))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: 8,
                                  }}
                                >
                                  <span>Email Conversation Details</span>
                                  {item.customer_email && (
                                    <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal', color: 'var(--qa-text-2, var(--qa-text-2))', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ color: 'var(--qa-text-3, var(--qa-text-2))' }}>User:</span>
                                      <strong style={{ color: 'var(--qa-text, #111111)', fontFamily: MONO }}>{item.customer_email}</strong>
                                    </span>
                                  )}
                                </div>

                                {/* Scrollable message content */}
                                <div style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                                  {/* Compliance Breaches banner if any */}
                                  {item.compliance_issues && item.compliance_issues.length > 0 && (
                                    <div
                                      style={{
                                        background: '#fff1f2',
                                        border: '1px solid #fecdd3',
                                        borderRadius: 8,
                                        padding: '10px 14px',
                                      }}
                                    >
                                      <div style={{ fontSize: 11, fontWeight: 700, color: '#9f1239', textTransform: 'uppercase' }}>
                                        Compliance Breaches
                                      </div>
                                      <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12, color: '#881337' }}>
                                        {item.compliance_issues.map((iss, i) => (
                                          <li key={i}>{iss}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Customer Context / Query Summary & History */}
                                  {/* 1. Customer Core Query (Separate & prominent) */}
                                  <CustomerCoreQueryCard
                                    threadSummary={item.thread_summary}
                                    customerMessage={item.customer_message}
                                    subjectLine={item.subject_line}
                                    customerEmail={item.customer_email}
                                    parameterScores={item.parameter_scores}
                                  />

                                  {/* 2. Customer Inbound Email Thread */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)' }}>
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
                                      <button
                                        type="button"
                                        onClick={() => setHistoryOpen(v => !v)}
                                        style={{
                                          height: 24,
                                          padding: '0 8px',
                                          borderRadius: 5,
                                          fontSize: 11,
                                          fontWeight: 600,
                                          cursor: 'pointer',
                                          border: '1px solid var(--qa-border)',
                                          background: historyOpen ? '#2D2D31' : '#FFFFFF',
                                          color: historyOpen ? '#FFFFFF' : 'var(--qa-text-2)',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 4,
                                          transition: 'all 0.15s',
                                        }}
                                      >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <circle cx="12" cy="12" r="10" />
                                          <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                        {historyOpen ? 'Hide History' : 'History'}
                                      </button>
                                    </div>

                                    {/* History Panel */}
                                    {historyOpen && (
                                      <EmailHistoryPanel
                                        customerEmail={item.customer_email}
                                        chatId={item.chat_id}
                                        ticketId={item.ticket_id}
                                        currentMessageId={item.message_id}
                                        onClose={() => setHistoryOpen(false)}
                                      />
                                    )}

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

                                  {/* Agent Reply */}
                                  <div>
                                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', marginBottom: 6 }}>
                                        My Outbound Reply
                                      </div>
                                      <div
                                        style={{
                                          background: '#FFFFFF',
                                          border: '1px solid var(--qa-border)',
                                          borderRadius: 8,
                                          padding: '14px 16px',
                                          maxHeight: 420,
                                          overflowY: 'auto',
                                        }}
                                      >
                                        <EmailMessageView
                                          content={item.agent_reply_text}
                                          fallback="No text reply content recorded."
                                        />
                                      </div>
                                    </div>
                                </div>

                                {/* Dispute Section at bottom */}
                                {(!isDisputed || activeTab !== 'evaluated' || disputeSuccessMsg || disputeError) && (
                                  <div
                                    style={{
                                      padding: '14px 16px',
                                      borderTop: '1px solid var(--qa-border)',
                                      background: '#FFFFFF',
                                      flexShrink: 0,
                                      maxHeight: isDisputed ? 360 : undefined,
                                      overflowY: isDisputed ? 'auto' : undefined,
                                    }}
                                  >
                                  {disputeSuccessMsg && (
                                    <div
                                      style={{
                                        padding: '8px 12px',
                                        fontSize: 12,
                                        color: '#166534',
                                        background: '#f0fdf4',
                                        border: '1px solid #bbf7d0',
                                        borderRadius: 6,
                                        marginBottom: 10,
                                      }}
                                    >
                                      ✓ {disputeSuccessMsg}
                                    </div>
                                  )}

                                  {disputeError && (
                                    <div
                                      style={{
                                        padding: '8px 12px',
                                        fontSize: 12,
                                        color: '#b91c1c',
                                        background: '#fef2f2',
                                        border: '1px solid #fecaca',
                                        borderRadius: 6,
                                        marginBottom: 10,
                                      }}
                                    >
                                      ✕ {disputeError}
                                    </div>
                                  )}

                                  {isDisputed ? (
                                    activeTab !== 'evaluated' ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div
                                          style={{
                                            background: isReviewedDispute
                                              ? item.dispute_status !== 'Rejected' ? '#f0fdf4' : '#fef2f2'
                                              : '#fefce8',
                                            border: `1px solid ${
                                              isReviewedDispute
                                                ? item.dispute_status !== 'Rejected' ? '#bbf7d0' : '#fecaca'
                                                : '#fef08a'
                                            }`,
                                            borderRadius: 8,
                                            padding: '12px 14px',
                                            fontSize: 12,
                                            color: isReviewedDispute
                                              ? item.dispute_status !== 'Rejected' ? '#166534' : '#991b1b'
                                              : '#854d0e',
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <div style={{ fontWeight: 600, fontSize: 13 }}>
                                              Dispute Status: {disputeLabel(item.dispute_status)}
                                            </div>
                                            {item.dispute_status === 'Raised' && (
                                              <button
                                                type="button"
                                                onClick={() => handleCancelDispute(item.message_id)}
                                                disabled={submittingDispute}
                                                style={{
                                                  fontSize: 11,
                                                  fontWeight: 600,
                                                  padding: '3px 8px',
                                                  borderRadius: 4,
                                                  background: '#FFFFFF',
                                                  border: '1px solid var(--qa-border)',
                                                  color: '#b91c1c',
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                {submittingDispute ? 'Cancelling…' : 'Cancel Dispute'}
                                              </button>
                                            )}
                                          </div>

                                          {item.challenged_params && item.challenged_params.length > 0 && (
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 6px' }}>
                                              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--qa-text-2)' }}>
                                                Challenged:
                                              </span>
                                              {item.challenged_params.map(cp => {
                                                const paramDef = DEFAULT_EMAIL_PARAMETERS.find(d => d.key === cp.param);
                                                return (
                                                  <span
                                                    key={cp.param}
                                                    title={cp.note}
                                                    style={{
                                                      fontSize: 11, fontWeight: 600,
                                                      background: '#FFFFFF',
                                                      border: '1px solid var(--qa-border)',
                                                      borderRadius: 4,
                                                      padding: '2px 8px',
                                                      color: '#3F3F46',
                                                    }}
                                                  >
                                                    {paramDef?.name || cp.param}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          )}

                                          <div style={{ marginTop: 4, lineHeight: 1.4 }}>&ldquo;{item.dispute_notes}&rdquo;</div>
                                        </div>

                                        {/* Integrated Dispute Discussion Thread */}
                                        <DisputeThread
                                          flagId={item.flag_id || item.message_id}
                                          agentNote={item.dispute_notes}
                                          agentName={item.agent_name || agentName}
                                          raisedByRole="agent"
                                          raisedByName={item.agent_name || agentName}
                                          reviewedBy={item.reviewed_by}
                                          qaName={(item as any).qa_name || item.reviewed_by}
                                          reviewerRole={item.dispute_status === 'TL_Resolved' ? 'tl' : 'quality'}
                                          flaggedAt={item.sent_at}
                                          reviewedAt={item.reviewed_at}
                                          compact
                                        />
                                      </div>
                                    ) : null
                                  ) : disputingId === item.message_id ? (
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
                                          Dispute this Score
                                        </div>
                                        <button
                                          type="button"
                                          onClick={cancelDisputeComposition}
                                          style={{ fontSize: 12, color: 'var(--qa-text-2)', background: 'none', border: 'none', cursor: 'pointer' }}
                                        >
                                          Cancel
                                        </button>
                                      </div>

                                      <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginBottom: 8 }}>
                                        Select the parameter(s) you wish to challenge:
                                      </div>

                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                                        {DEFAULT_EMAIL_PARAMETERS.map(param => {
                                          const isSelected = selectedParams.has(param.key);
                                          return (
                                            <label
                                              key={param.key}
                                              style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '6px 10px',
                                                borderRadius: 6,
                                                border: `1px solid ${isSelected ? '#111111' : 'var(--qa-border)'}`,
                                                background: isSelected ? 'var(--qa-gray-50)' : '#FFFFFF',
                                                cursor: 'pointer',
                                                fontSize: 12,
                                                fontWeight: 500,
                                              }}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleParamPick(param.key)}
                                                style={{ accentColor: '#111111', cursor: 'pointer' }}
                                              />
                                              {param.name}
                                            </label>
                                          );
                                        })}
                                      </div>

                                      <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginBottom: 4 }}>
                                        Reason for dispute (required):
                                      </div>
                                      <textarea
                                        rows={3}
                                        placeholder="Explain specifically why you think the score should be adjusted..."
                                        value={disputeNotes}
                                        onChange={(e) => setDisputeNotes(e.target.value)}
                                        style={{
                                          width: '100%',
                                          padding: '8px 12px',
                                          border: '1px solid var(--qa-border)',
                                          borderRadius: 6,
                                          background: '#FFFFFF',
                                          color: 'var(--qa-text)',
                                          fontSize: 12,
                                          fontFamily: SANS,
                                          outline: 'none',
                                          resize: 'vertical',
                                          boxSizing: 'border-box',
                                          marginBottom: 10,
                                        }}
                                      />
                                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                        <button
                                          type="button"
                                          onClick={cancelDisputeComposition}
                                          style={{
                                            height: 32,
                                            padding: '0 14px',
                                            borderRadius: 6,
                                            border: '1px solid var(--qa-border)',
                                            background: '#FFFFFF',
                                            color: 'var(--qa-text)',
                                            fontSize: 12,
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleRaiseDispute(item.message_id)}
                                          disabled={submittingDispute || !disputeNotes.trim() || selectedParams.size === 0}
                                          style={{
                                            height: 32,
                                            padding: '0 16px',
                                            border: 'none',
                                            borderRadius: 6,
                                            background: 'var(--qa-gray-700, #111111)',
                                            color: '#fff',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: !disputeNotes.trim() || selectedParams.size === 0 ? 'not-allowed' : 'pointer',
                                            opacity: !disputeNotes.trim() || selectedParams.size === 0 ? 0.5 : 1,
                                            fontFamily: SANS,
                                          }}
                                        >
                                          {submittingDispute ? 'Submitting…' : 'Submit Dispute'}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
                                          Dispute this Score
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--qa-text-2)' }}>
                                          Challenge specific parameter grades and submit to Team Lead for review.
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => startDispute(item)}
                                        style={{
                                          height: 34,
                                          padding: '0 16px',
                                          border: '1px solid var(--qa-border)',
                                          borderRadius: 6,
                                          background: '#FFFFFF',
                                          color: 'var(--qa-text)',
                                          fontSize: 12,
                                          fontWeight: 600,
                                          cursor: 'pointer',
                                          fontFamily: SANS,
                                        }}
                                      >
                                        Raise Dispute
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
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
        <Pager page={paging.page} pages={paging.pages} onPage={paging.setPage} />
      </div>
    </div>
  );
}
