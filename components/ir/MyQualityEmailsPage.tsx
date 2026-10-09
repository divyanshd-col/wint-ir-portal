'use client';

import React, { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import type { CSSProperties } from 'react';
import { DEFAULT_EMAIL_PARAMETERS } from '@/lib/email/context-builder';
import EmailMessageView, { stripHtml, CustomerSummaryBlock, EmailHistoryPanel } from '@/components/quality/EmailContentRenderer';

interface EvaluationItem {
  id: number;
  ticket_id: string;
  message_id: string;
  chat_id?: string;
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
  dispute_status?: 'None' | 'Raised' | 'Under_Review' | 'Resolved' | 'Rejected';
  dispute_notes?: string;
  subject_line?: string;
  thread_summary?: any;
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

// ─── Badges (Exact match with MyQualityChatsPage) ─────────────────────────────

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

function renderParamBadge(v: any) {
  const s = String(v ?? '').toLowerCase().trim();
  const norm: 'yes' | 'partial' | 'no' | 'na' =
    s === 'yes' || s === 'pass' || s === '1' || s === 'true'
      ? 'yes'
      : s === 'partial' || s === 'half' || s === '0.5'
      ? 'partial'
      : s === 'no' || s === 'fail' || s === '0' || s === 'false'
      ? 'no'
      : typeof v === 'number' && v >= 80
      ? 'yes'
      : typeof v === 'number' && v >= 40
      ? 'partial'
      : typeof v === 'number'
      ? 'no'
      : 'na';

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {(['yes', 'partial', 'no'] as const).map(opt => {
        const isSel = norm === opt;
        const label = opt === 'yes' ? 'Yes' : opt === 'partial' ? 'Partial' : 'No';

        let bg = 'var(--qa-card, #FFFFFF)';
        let color = 'var(--qa-text-3, #A1A1AA)';
        let border = '1px solid var(--qa-border-sub, #F4F4F5)';

        if (isSel) {
          if (opt === 'yes') {
            bg = '#DCFCE7';
            color = '#15803D';
            border = '1px solid #86EFAC';
          } else if (opt === 'partial') {
            bg = '#FEF3C7';
            color = '#B45309';
            border = '1px solid #FDE68A';
          } else if (opt === 'no') {
            bg = '#FEE2E2';
            color = '#B91C1C';
            border = '1px solid #FCA5A5';
          }
        }

        return (
          <span
            key={opt}
            style={{
              height: 24,
              padding: '0 8px',
              borderRadius: 6,
              border,
              background: bg,
              color,
              fontSize: 11,
              fontWeight: isSel ? 700 : 400,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: SANS,
            }}
          >
            {isSel && (opt === 'yes' ? '✓ ' : opt === 'partial' ? '½ ' : '✗ ')}
            {label}
          </span>
        );
      })}
    </div>
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

function ScoreRing({ score }: { score: number | null }) {
  const val = score ?? 0;
  const r = 27;
  const circ = 2 * Math.PI * r; // ≈ 169.6
  const offset = circ - (val / 100) * circ;
  return (
    <svg width={64} height={64} style={{ flexShrink: 0 }}>
      <circle cx={32} cy={32} r={r} stroke="#E4E4E7" strokeWidth={5} fill="none" />
      <circle
        cx={32}
        cy={32}
        r={r}
        stroke="#2D2D31"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
        style={{ transition: 'stroke-dashoffset 0.3s' }}
      />
      <text
        x={32}
        y={33}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={18}
        fontWeight={700}
        fill="#111111"
        fontFamily={SANS}
      >
        {score !== null ? val : '—'}
      </text>
    </svg>
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
  const [search, setSearch] = useState('');
  const [complianceFilter, setComplianceFilter] = useState<'' | 'compliant' | 'breach'>('');

  // Dispute state
  const [disputeNotes, setDisputeNotes] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeSuccessMsg, setDisputeSuccessMsg] = useState<string | null>(null);

  const fetchMyEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agentName) params.set('agentName', agentName);
      params.set('status', 'Completed');

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
  }, [agentName]);

  useEffect(() => {
    fetchMyEvaluations();
  }, [fetchMyEvaluations]);

  const handleRaiseDispute = async (messageId: string) => {
    if (!disputeNotes.trim()) return;
    setSubmittingDispute(true);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'raise_dispute',
          messageId,
          notes: disputeNotes,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDisputeSuccessMsg('Dispute raised successfully. The QA team has been notified.');
        setDisputeNotes('');
        fetchMyEvaluations();
      }
    } catch (e) {
      console.error(e);
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
      (item) => item.dispute_status === 'Resolved' || item.dispute_status === 'Rejected'
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
        if (!matchTicket && !matchSub && !matchReply) return false;
      }
      if (complianceFilter === 'compliant' && item.compliance_passed === false) return false;
      if (complianceFilter === 'breach' && item.compliance_passed !== false) return false;
      return true;
    });
  }, [activeTab, evaluatedItems, disputesRaisedItems, reviewedDisputesItems, search, complianceFilter]);

  const hasFilters = Boolean(search || complianceFilter);
  const clearFilters = () => {
    setSearch('');
    setComplianceFilter('');
  };

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
    transition: 'background 0.15s, color 0.15s',
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
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>
          My Quality Emails
        </h1>
        <p style={{ fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)', margin: '4px 0 0' }}>
          View evaluated email replies, track parameter grading, and raise or monitor disputes for {agentName}.
        </p>
      </div>

      {/* ── KPI Cards (Consistent with MyQualityChatsPage) ── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, #E4E4E7)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', fontWeight: 500 }}>
              My Quality Average
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#111111', marginTop: 6, fontFamily: MONO }}>
              {summary.avgScore ? `${summary.avgScore}%` : 'N/A'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, #6B6B6B)', marginTop: 4 }}>
              Target: 85%+
            </div>
          </div>

          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, #E4E4E7)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', fontWeight: 500 }}>
              Evaluated Replies
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#111111', marginTop: 6, fontFamily: MONO }}>
              {summary.completedCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, #6B6B6B)', marginTop: 4 }}>
              Batch processed
            </div>
          </div>

          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, #E4E4E7)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', fontWeight: 500 }}>
              Compliance Rate
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#166534', marginTop: 6, fontFamily: MONO }}>
              {summary.completedCount > 0
                ? `${Math.round(((summary.completedCount - summary.complianceBreachCount) / summary.completedCount) * 100)}%`
                : '100%'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, #6B6B6B)', marginTop: 4 }}>
              Zero regulatory breaches
            </div>
          </div>

          <div
            style={{
              background: 'var(--qa-card, #FFFFFF)',
              border: '1px solid var(--qa-border, #E4E4E7)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', fontWeight: 500 }}>
              Active Disputes
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#6b21a8', marginTop: 6, fontFamily: MONO }}>
              {summary.activeDisputesCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--qa-text-2, #6B6B6B)', marginTop: 4 }}>
              Awaiting QA arbitration
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs & Interaction Bar (Exact match with MyQualityChatsPage) ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
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

      {/* ── Table Container Card ── */}
      <div
        style={{
          background: 'var(--qa-card, #FFFFFF)',
          border: '1px solid var(--qa-border, #E4E4E7)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Single-line Filter Bar */}
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
          {/* Filter Inputs Group */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Search */}
            <input
              type="text"
              placeholder="Search Ticket ID or Subject…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...chipInputStyle, width: 220 }}
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

            {hasFilters && (
              <button
                onClick={clearFilters}
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

          {/* Records Counter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 'auto' }}>
            <span style={{ fontSize: 13, color: '#A1A1AA', whiteSpace: 'nowrap' }}>
              Showing {currentTabItems.length} of {items.length} records
            </span>
          </div>
        </div>

        {/* Data Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 150 }} />
              <col style={{ width: 140 }} />
              <col />
              <col style={{ width: 95 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={TH_BASE}>Sent Date</th>
                <th style={TH_BASE}>Ticket ID</th>
                <th style={TH_BASE}>Subject / Reply Snippet</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS</th>
                <th style={TH_BASE}>Compliance</th>
                <th style={TH_BASE}>Dispute</th>
                <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    Loading email quality evaluations…
                  </td>
                </tr>
              ) : currentTabItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '36px 0' }}>
                    No evaluations found in this view.
                  </td>
                </tr>
              ) : (
                currentTabItems.map((item, idx) => {
                  const isOpen = expandedId === item.message_id;
                  const isLast = idx === currentTabItems.length - 1 && !isOpen;
                  const score = item.effective_score ?? item.quality_score ?? null;
                  const isOverridden = item.qa_override_score !== null && item.qa_override_score !== undefined;
                  const isDisputed = item.dispute_status && item.dispute_status !== 'None';
                  const isReviewedDispute = item.dispute_status === 'Resolved' || item.dispute_status === 'Rejected';

                  return (
                    <Fragment key={item.message_id}>
                      <tr
                        style={{
                          background: isOpen ? '#FAFAFB' : '#FFFFFF',
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ ...TD_MONO, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          {new Date(item.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{' '}
                          <span style={{ fontSize: 11, color: '#A1A1AA' }}>
                            {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td style={{ ...TD_MONO, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          {item.ticket_id.slice(0, 12)}…
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                            {item.subject_line || 'Email Support'}
                          </span>
                          <span style={{ color: 'var(--qa-text-2, #6B6B6B)', marginLeft: 8 }}>
                            — {item.agent_reply_text ? stripHtml(item.agent_reply_text).slice(0, 55) + '…' : ''}
                          </span>
                        </td>
                        <td style={{ ...TD_NUM, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <IQSBadge score={score} />
                            {isOverridden && (
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: '1px 4px',
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  background: '#f4f4f5',
                                  color: '#52525b',
                                  border: '1px solid #e4e4e7',
                                }}
                                title="Adjusted by QA"
                              >
                                QA
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
                          {item.compliance_passed === false ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 6,
                                background: '#fef2f2',
                                color: '#991b1b',
                                border: '1px solid #fecaca',
                              }}
                            >
                              Non-Compliant
                            </span>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 6,
                                background: '#f0fdf4',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                              }}
                            >
                              Compliant
                            </span>
                          )}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 12 }}>
                          {isDisputed ? (
                            isReviewedDispute ? (
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: item.dispute_status === 'Resolved' ? '#f0fdf4' : '#fef2f2',
                                  color: item.dispute_status === 'Resolved' ? '#166534' : '#991b1b',
                                  border: `1px solid ${item.dispute_status === 'Resolved' ? '#bbf7d0' : '#fecaca'}`,
                                }}
                              >
                                {item.dispute_status}
                              </span>
                            ) : (
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: '#fefce8',
                                  color: '#854d0e',
                                  border: '1px solid #fef08a',
                                }}
                              >
                                Pending TL Review
                              </span>
                            )
                          ) : (
                            <span style={{ color: '#A1A1AA' }}>—</span>
                          )}
                        </td>
                        <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right' }}>
                          <button
                            onClick={() => {
                              setExpandedId(isOpen ? null : item.message_id);
                              setDisputeSuccessMsg(null);
                            }}
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

                      {/* ── Expanded Detail Drawer (Exact match with IRScorePanel) ── */}
                      {isOpen && (
                        <tr style={{ background: '#FAFAFB' }}>
                          <td colSpan={7} style={{ padding: '0 16px 16px' }}>
                            <div
                              style={{
                                display: 'flex',
                                border: '1px solid #E4E4E7',
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
                                  borderRight: '1px solid #E4E4E7',
                                  display: 'flex',
                                  flexDirection: 'column',
                                }}
                              >
                                {/* Header */}
                                <div style={{ padding: 16, borderBottom: '1px solid #E4E4E7', flexShrink: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    <ScoreRing score={score} />
                                    <div>
                                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111111' }}>
                                        {item.agent_name || agentName}
                                      </div>
                                      <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 4 }}>
                                        <span style={{ fontFamily: MONO }}>{item.ticket_id}</span>
                                        {' · '}
                                        {new Date(item.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                      </div>
                                      {isOverridden && (
                                        <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600, marginTop: 4 }}>
                                          QA Adjusted from {item.quality_score}%
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Section Header */}
                                <div
                                  style={{
                                    padding: '10px 16px',
                                    borderBottom: '1px solid #E4E4E7',
                                    background: '#FAFAFB',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: 'var(--qa-text-2, #6B6B6B)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                >
                                  <span>Parameter Scores (6)</span>
                                  <span style={{ fontSize: 11, fontWeight: 400, color: '#A1A1AA' }}>IQS Breakdown</span>
                                </div>

                                {/* Parameters List */}
                                <div style={{ flex: 1, overflowY: 'auto' }}>
                                  {DEFAULT_EMAIL_PARAMETERS.map((def, pIdx) => {
                                    const val = item.parameter_scores?.[def.key];
                                    const isLastP = pIdx === DEFAULT_EMAIL_PARAMETERS.length - 1;
                                    return (
                                      <div
                                        key={def.key}
                                        style={{
                                          padding: '12px 16px',
                                          borderBottom: isLastP ? 'none' : '1px solid #F0F0F2',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 12,
                                        }}
                                      >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                                            {def.name}
                                          </div>
                                          <div style={{ fontSize: 11, color: 'var(--qa-text-3, #71717A)', marginTop: 2, lineHeight: 1.3 }}>
                                            {def.description}
                                          </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                          {renderParamBadge(val)}
                                          <span style={{ fontSize: 11, color: '#A1A1AA', fontFamily: MONO, minWidth: 28, textAlign: 'right' }}>
                                            {def.defaultWeight}%
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* QA Feedback / Remarks Card */}
                                {item.qa_notes && (
                                  <div style={{ padding: 16, borderTop: '1px solid #E4E4E7', background: '#FAFAFB', flexShrink: 0 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', marginBottom: 6 }}>
                                      QA Feedback &amp; Remarks
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--qa-text, #111111)', lineHeight: 1.5 }}>
                                      {item.qa_notes}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* ── Right Pane: Customer Email, Agent Reply & Dispute Box ── */}
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                {/* Header */}
                                <div
                                  style={{
                                    padding: '12px 16px',
                                    borderBottom: '1px solid #E4E4E7',
                                    background: '#FAFAFB',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: 'var(--qa-text-2, #6B6B6B)',
                                  }}
                                >
                                  Email Conversation Details
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
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
                                        Customer Context &amp; Query Summary
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
                                          border: '1px solid #E4E4E7',
                                          background: historyOpen ? '#2D2D31' : '#FFFFFF',
                                          color: historyOpen ? '#FFFFFF' : '#71717A',
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
                                        onClose={() => setHistoryOpen(false)}
                                      />
                                    )}

                                    {/* Customer Context: ONLY SUMMARY */}
                                    <div
                                      style={{
                                        background: '#F4F4F5',
                                        border: '1px solid #E4E4E7',
                                        borderRadius: 8,
                                        padding: '12px 16px',
                                      }}
                                    >
                                      <CustomerSummaryBlock
                                        threadSummary={item.thread_summary}
                                        customerMessage={item.customer_message}
                                        subjectLine={item.subject_line}
                                      />
                                    </div>
                                  </div>

                                    {/* Agent Reply */}
                                    <div>
                                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A', marginBottom: 6 }}>
                                        My Outbound Reply
                                      </div>
                                      <div
                                        style={{
                                          background: '#FFFFFF',
                                          border: '1px solid #E4E4E7',
                                          borderRadius: 8,
                                          padding: '14px 16px',
                                          maxHeight: 280,
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
                                <div
                                  style={{
                                    padding: '14px 16px',
                                    borderTop: '1px solid #E4E4E7',
                                    background: '#FFFFFF',
                                    flexShrink: 0,
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

                                  {isDisputed ? (
                                    <div
                                      style={{
                                        background: isReviewedDispute
                                          ? item.dispute_status === 'Resolved' ? '#f0fdf4' : '#fef2f2'
                                          : '#fefce8',
                                        border: `1px solid ${
                                          isReviewedDispute
                                            ? item.dispute_status === 'Resolved' ? '#bbf7d0' : '#fecaca'
                                            : '#fef08a'
                                        }`,
                                        borderRadius: 8,
                                        padding: '10px 14px',
                                        fontSize: 12,
                                        color: isReviewedDispute
                                          ? item.dispute_status === 'Resolved' ? '#166534' : '#991b1b'
                                          : '#854d0e',
                                      }}
                                    >
                                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                                        Dispute Status: {item.dispute_status}
                                      </div>
                                      <div>&ldquo;{item.dispute_notes}&rdquo;</div>
                                    </div>
                                  ) : (
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111111', marginBottom: 6 }}>
                                        Dispute this Score
                                      </div>
                                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                        <textarea
                                          rows={2}
                                          placeholder="Explain reason for dispute to QA Lead…"
                                          value={disputeNotes}
                                          onChange={(e) => setDisputeNotes(e.target.value)}
                                          style={{
                                            flex: 1,
                                            padding: '8px 12px',
                                            border: '1px solid #E4E4E7',
                                            borderRadius: 6,
                                            background: '#FFFFFF',
                                            color: '#111111',
                                            fontSize: 12,
                                            fontFamily: SANS,
                                            outline: 'none',
                                            resize: 'vertical',
                                          }}
                                        />
                                        <button
                                          onClick={() => handleRaiseDispute(item.message_id)}
                                          disabled={submittingDispute || !disputeNotes.trim()}
                                          style={{
                                            height: 36,
                                            padding: '0 16px',
                                            border: 'none',
                                            borderRadius: 6,
                                            background: 'var(--qa-gray-700, #111111)',
                                            color: '#fff',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: !disputeNotes.trim() ? 'not-allowed' : 'pointer',
                                            opacity: !disputeNotes.trim() ? 0.6 : 1,
                                            whiteSpace: 'nowrap',
                                            fontFamily: SANS,
                                          }}
                                        >
                                          {submittingDispute ? 'Submitting…' : 'Submit Dispute'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
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
      </div>
    </div>
  );
}
