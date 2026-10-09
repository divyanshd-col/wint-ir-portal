'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DateRangePicker from './DateRangePicker';
import { DEFAULT_EMAIL_PARAMETERS, ParameterScoreValue } from '@/lib/email/context-builder';
import EmailMessageView, { CustomerSummaryBlock, EmailHistoryPanel } from './EmailContentRenderer';

type Tab = 'pending' | 'reviewed' | 'disputes';

interface EvaluationItem {
  id: number;
  ticket_id: string;
  message_id: string;
  chat_id?: string;
  customer_email?: string;
  agent_id?: string;
  agent_name?: string;
  sent_at: string;
  customer_message?: string;
  agent_reply_text?: string;
  evaluation_status: 'Pending' | 'In_Batch' | 'Completed' | 'Failed' | 'Skipped';
  batch_job_id?: string;
  quality_score?: number;
  compliance_passed?: boolean;
  compliance_issues?: string[];
  parameter_scores?: Record<string, string | number>;
  qa_override_score?: number;
  qa_notes?: string;
  dispute_status?: 'None' | 'Raised' | 'Under_Review' | 'Resolved' | 'Rejected';
  dispute_notes?: string;
  evaluated_at?: string;
  subject_line?: string;
  thread_summary?: any;
  effective_score?: number;
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
function ScoreRing({ score }: { score: number | null }) {
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
function QualityScoreBadge({ score, isOverridden }: { score: number | null; isOverridden?: boolean }) {
  if (score == null) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>;
  const bg = score >= 85 ? '#dcfce7' : score >= 70 ? '#fef9c3' : '#fee2e2';
  const color = score >= 85 ? '#15803d' : score >= 70 ? '#854d0e' : '#b91c1c';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
        fontFamily: MONO, fontWeight: 600, background: bg, color,
      }}>
        {score}
      </span>
      {isOverridden && (
        <span style={{
          fontSize: 10, padding: '1px 4px', borderRadius: 4, fontWeight: 700,
          background: '#f4f4f5', color: '#52525b', border: '1px solid #e4e4e7',
        }}>
          QA
        </span>
      )}
    </div>
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

export default function EmailEvaluationPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [availableAgents, setAvailableAgents] = useState<string[]>([
    'Aman Sharma',
    'Apoorv',
    'Bhavika',
    'Kriti',
    'Priya Singh',
    'Vedant G',
  ]);
  const [complianceFailedOnly, setComplianceFailedOnly] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // QA action state
  const [overrideScores, setOverrideScores] = useState<Record<string, number>>({});
  const [overrideParams, setOverrideParams] = useState<Record<string, Record<string, ParameterScoreValue>>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [submittingAction, setSubmittingAction] = useState(false);

  const normalizeToggleValue = (val: any): ParameterScoreValue => {
    if (val === 'yes' || val === 'partial' || val === 'no') return val;
    if (typeof val === 'string') {
      const s = val.toLowerCase().trim();
      if (s === 'yes' || s === 'pass') return 'yes';
      if (s === 'partial') return 'partial';
      if (s === 'no' || s === 'fail') return 'no';
    }
    if (typeof val === 'number') {
      if (val >= 80) return 'yes';
      if (val >= 50) return 'partial';
      return 'no';
    }
    return 'yes';
  };

  const calculateIQS = (params: Record<string, ParameterScoreValue>): number => {
    let totalWeight = 0;
    let earned = 0;

    DEFAULT_EMAIL_PARAMETERS.forEach(def => {
      const weight = def.defaultWeight || 1;
      totalWeight += weight;
      const val = params[def.key] ?? 'yes';
      if (val === 'yes') {
        earned += weight * 100;
      } else if (val === 'partial') {
        earned += weight * 50;
      } else {
        earned += 0;
      }
    });

    return totalWeight > 0 ? Math.round(earned / totalWeight) : 0;
  };

  const getParamsForItem = (item: EvaluationItem): Record<string, ParameterScoreValue> => {
    if (overrideParams[item.message_id]) {
      return overrideParams[item.message_id];
    }
    const current = item.parameter_scores || {};
    const initial: Record<string, ParameterScoreValue> = {};
    DEFAULT_EMAIL_PARAMETERS.forEach(def => {
      initial[def.key] = normalizeToggleValue(current[def.key]);
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
      if (complianceFailedOnly) params.set('complianceFailed', 'true');

      if (tab === 'pending') {
        params.set('status', 'Pending');
      } else if (tab === 'disputes') {
        params.set('disputesOnly', 'true');
      } else if (tab === 'reviewed') {
        params.set('status', 'Completed');
      }

      const res = await fetch(`/api/email-evaluations?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        if (data.agentBreakdown && data.agentBreakdown.length > 0) {
          const names = data.agentBreakdown.map((a: any) => a.agent_name).filter(Boolean);
          setAvailableAgents(prev => Array.from(new Set([...prev, ...names])).sort());
        }
        let rows: EvaluationItem[] = data.items || [];
        if (customFrom && customTo) {
          const from = new Date(customFrom + 'T00:00:00Z').getTime();
          const to = new Date(customTo + 'T23:59:59Z').getTime();
          rows = rows.filter(r => {
            const t = new Date(r.sent_at).getTime();
            return t >= from && t <= to;
          });
        }
        setItems(rows);
      }
    } catch (err) {
      console.error('[email-eval] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [tab, search, agentFilter, complianceFailedOnly, customFrom, customTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Tab switch handler
  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);
    setExpandedId(null);
  };

  const handleSaveQAOverride = async (item: EvaluationItem) => {
    const currentParams = getParamsForItem(item);
    const scoreVal = overrideScores[item.message_id] !== undefined
      ? Number(overrideScores[item.message_id])
      : (item.effective_score ?? item.quality_score ?? calculateIQS(currentParams));

    setSubmittingAction(true);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'qa_override',
          messageId: item.message_id,
          overrideScore: Number(scoreVal),
          qaNotes: item.qa_notes || 'QA Review Override',
          parameterScores: currentParams,
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
        fetchData();
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

    setSubmittingAction(true);
    try {
      const res = await fetch('/api/email-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_dispute',
          messageId: item.message_id,
          decision,
          notes: item.qa_notes || `Dispute marked as ${decision}`,
          newScore: scoreVal ? Number(scoreVal) : undefined,
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

  const hasFilters = Boolean(search || agentFilter || complianceFailedOnly || customFrom);

  const agentOptions = Array.from(new Set([
    ...availableAgents,
    ...items.map(i => i.agent_name).filter(Boolean),
  ])).sort();

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 8px 40px' }}>
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
            Email Quality Evaluation
          </h1>
          <p style={{ fontSize: 13, color: 'var(--qa-text-2)', margin: '4px 0 0' }}>
            Quality assurance evaluations with IQS parameter grading, overrides, and dispute arbitration
          </p>
        </div>
      </div>

      {/* ── Tab Bar (Exact styling of ChatEvaluationPage) ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{
          display: 'flex', gap: 4,
          background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
          borderRadius: 10, padding: 4, width: 'fit-content',
        }}>
          <button style={tabStyle(tab === 'pending')} onClick={() => handleTabChange('pending')}>
            Pending Batch
            {tab === 'pending' && <CountBadge count={items.length} active={true} />}
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => handleTabChange('reviewed')}>
            Reviewed Emails
            {tab === 'reviewed' && <CountBadge count={items.length} active={true} />}
          </button>
          <button style={tabStyle(tab === 'disputes')} onClick={() => handleTabChange('disputes')}>
            Disputes
            {tab === 'disputes' && <CountBadge count={items.length} active={true} />}
          </button>
        </div>
      </div>

      {/* ── Filter Toolbar (Matching ChatEvalTable) ── */}
      <div style={{
        background: 'var(--qa-card)',
        border: '1px solid var(--qa-border)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
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

        {/* Compliance Failures Chip */}
        <button
          onClick={() => setComplianceFailedOnly(!complianceFailedOnly)}
          style={complianceFailedOnly ? chipActive : chip}
        >
          Compliance Failures
        </button>

        {/* Date Range Picker */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            style={customFrom ? chipActive : chip}
            onClick={() => setShowDatePicker(v => !v)}
          >
            {customFrom && customTo
              ? `${new Date(customFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(customTo).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              : 'Date range'}
            <span style={{ fontSize: 9, marginLeft: 2 }}>▾</span>
          </button>
          {showDatePicker && (
            <DateRangePicker
              onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setShowDatePicker(false); }}
              onCancel={() => setShowDatePicker(false)}
            />
          )}
        </div>

        {/* Reset Filters */}
        <button
          disabled={!hasFilters}
          onClick={() => { setSearch(''); setAgentFilter(''); setComplianceFailedOnly(false); setCustomFrom(''); setCustomTo(''); }}
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
        <span style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>
          {loading ? 'Loading…' : `${items.length} replies`}
        </span>
      </div>

      {/* ── Table Container ── */}
      <div style={{
        background: 'var(--qa-card)',
        border: '1px solid var(--qa-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Sent At</th>
                <th style={th}>Agent</th>
                <th style={th}>Ticket ID</th>
                <th style={th}>Subject</th>
                <th style={{ ...th, textAlign: 'right' }}>IQS</th>
                <th style={th}>Compliance</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} style={td}>
                        <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: '60%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '48px 16px' }}>
                    No email reply evaluations found matching filters
                  </td>
                </tr>
              ) : (
                items.map(item => {
                  const isExpanded = expandedId === item.message_id;
                  const itemParams = getParamsForItem(item);
                  const isSessionOverridden = overrideScores[item.message_id] !== undefined;
                  const currentIQS = isSessionOverridden
                    ? Number(overrideScores[item.message_id])
                    : (item.effective_score ?? item.quality_score ?? calculateIQS(itemParams));
                  const hasOverride = item.qa_override_score !== null && item.qa_override_score !== undefined;

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
                        <td style={tdMono}>
                          {new Date(item.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{' '}
                          <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>
                            {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.agent_name || 'Unassigned'}
                        </td>
                        <td style={tdMono}>
                          {item.ticket_id.slice(0, 8)}…
                        </td>
                        <td style={{ ...td, color: 'var(--qa-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.subject_line || 'Email Support'}
                        </td>
                        <td style={tdNum}>
                          <QualityScoreBadge score={currentIQS} isOverridden={hasOverride || isSessionOverridden} />
                        </td>
                        <td style={td}>
                          {item.compliance_passed === false ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 12, fontWeight: 600, color: '#b91c1c',
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626' }} />
                              Failed
                            </span>
                          ) : item.compliance_passed === true ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 12, fontWeight: 500, color: 'var(--accent)',
                            }}>
                              <span style={{ fontSize: 10 }}>✓</span> Compliant
                            </span>
                          ) : (
                            <span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td style={td}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center',
                            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                            background: item.evaluation_status === 'Completed' ? '#dcfce7' : item.evaluation_status === 'In_Batch' ? '#e0f2fe' : '#fef3c7',
                            color: item.evaluation_status === 'Completed' ? '#15803d' : item.evaluation_status === 'In_Batch' ? '#0369a1' : '#b45309',
                          }}>
                            {item.evaluation_status}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--qa-text-2)' }}>
                            {isExpanded ? 'Hide ▲' : 'Review ▼'}
                          </span>
                        </td>
                      </tr>

                      {/* ── Expanded Inline Review Drawer (Matching EvalPanel Structure) ── */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid var(--qa-border)' }}>
                            <div style={{
                              background: 'var(--qa-gray-50)',
                              borderTop: '1px solid var(--qa-border-sub)',
                              padding: '24px 28px',
                              display: 'grid',
                              gridTemplateColumns: '1.2fr 1fr',
                              gap: 28,
                            }}>
                              {/* Left Pane: Customer Query Context & Agent Outbound Reply */}
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
                                    maxHeight: 260,
                                    overflowY: 'auto',
                                  }}>
                                    <EmailMessageView
                                      content={item.agent_reply_text}
                                      fallback="No message content available."
                                    />
                                  </div>
                                </div>

                                {item.dispute_status && item.dispute_status !== 'None' && (
                                  <div style={{
                                    background: '#faf5ff',
                                    border: '1px solid #e9d5ff',
                                    borderRadius: 8,
                                    padding: '12px 14px',
                                  }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b21a8' }}>
                                      Dispute Raised by Agent ({item.dispute_status})
                                    </div>
                                    <div style={{ fontSize: 13, color: '#3b0764', marginTop: 4 }}>
                                      {item.dispute_notes}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Right Pane: AI Score Ring, Parameters, Compliance & QA Override Form */}
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
                                        {currentIQS != null ? `${currentIQS}%` : 'Pending'}
                                      </div>
                                      {isSessionOverridden && item.quality_score != null ? (
                                        <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600 }}>
                                          Adjusted from {item.quality_score}%
                                        </div>
                                      ) : hasOverride && item.quality_score != null ? (
                                        <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600 }}>
                                          QA Override from {item.quality_score}%
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
                                        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: '#fee2e2', color: '#b91c1c' }}>
                                          Non-Compliant
                                        </span>
                                      ) : item.compliance_passed === true ? (
                                        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>
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
                                      Parameter Scores
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
                                      const val = currentParams[def.key] ?? 'yes';
                                      return (
                                        <div
                                          key={def.key}
                                          style={{
                                            padding: '12px 16px',
                                            borderBottom: idx < DEFAULT_EMAIL_PARAMETERS.length - 1 ? '1px solid var(--qa-border-sub)' : 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                          }}
                                        >
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--qa-text)' }}>
                                              {def.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--qa-text-3)', lineHeight: 1.3, marginTop: 2 }}>
                                              {def.description}
                                            </div>
                                          </div>

                                          {/* Yes / Partial / No buttons (Matching EvalPanel in chats) */}
                                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                            {([
                                              { val: 'yes', label: 'Yes' },
                                              { val: 'partial', label: 'Partial' },
                                              { val: 'no', label: 'No' },
                                            ] as const).map(({ val: optVal, label }) => {
                                              const isSel = val === optVal;
                                              return (
                                                <button
                                                  key={optVal}
                                                  type="button"
                                                  onClick={() => handleParamChange(item.message_id, def.key, optVal)}
                                                  style={{
                                                    height: 28,
                                                    padding: '0 11px',
                                                    borderRadius: 8,
                                                    border: isSel
                                                      ? optVal === 'yes'
                                                        ? '1px solid #86EFAC'
                                                        : optVal === 'partial'
                                                        ? '1px solid #FDE68A'
                                                        : '1px solid #FCA5A5'
                                                      : '1px solid var(--qa-border)',
                                                    background: isSel
                                                      ? optVal === 'yes'
                                                        ? '#DCFCE7'
                                                        : optVal === 'partial'
                                                        ? '#FEF3C7'
                                                        : '#FEE2E2'
                                                      : 'var(--qa-card)',
                                                    color: isSel
                                                      ? optVal === 'yes'
                                                        ? '#15803D'
                                                        : optVal === 'partial'
                                                        ? '#B45309'
                                                        : '#B91C1C'
                                                      : 'var(--qa-text-2)',
                                                    fontSize: 12,
                                                    fontFamily: 'inherit',
                                                    fontWeight: isSel ? 700 : 400,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.12s',
                                                  }}
                                                >
                                                  {isSel && (optVal === 'yes' ? '✓ ' : optVal === 'partial' ? '½ ' : '✗ ')}
                                                  {label}
                                                </button>
                                              );
                                            })}
                                          </div>

                                          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontFamily: MONO, flexShrink: 0, minWidth: 32, textAlign: 'right' }}>
                                            {def.defaultWeight}%
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* AI Feedback Summary */}
                                {item.qa_notes && (
                                  <div>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 6 }}>
                                      Evaluator Feedback &amp; Summary
                                    </div>
                                    <div style={{
                                      background: 'var(--qa-card)',
                                      border: '1px solid var(--qa-border)',
                                      borderRadius: 6,
                                      padding: '10px 12px',
                                      fontSize: 12,
                                      color: 'var(--qa-text)',
                                      lineHeight: 1.5,
                                    }}>
                                      {item.qa_notes}
                                    </div>
                                  </div>
                                )}

                                {/* Action Bar: Save / Override */}
                                <div style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  paddingTop: 6,
                                }}>
                                  <div>
                                    {item.dispute_status === 'Raised' && (
                                      <div style={{ display: 'flex', gap: 6 }}>
                                        <button
                                          onClick={() => handleResolveDispute(item, 'Resolved')}
                                          disabled={submittingAction}
                                          style={{
                                            height: 32, padding: '0 12px', border: 'none', borderRadius: 6,
                                            background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                          }}
                                        >
                                          Accept Dispute
                                        </button>
                                        <button
                                          onClick={() => handleResolveDispute(item, 'Rejected')}
                                          disabled={submittingAction}
                                          style={{
                                            height: 32, padding: '0 12px', border: 'none', borderRadius: 6,
                                            background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                          }}
                                        >
                                          Reject Dispute
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                                    <button
                                      onClick={() => handleSaveQAOverride(item)}
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
                                      {submittingAction ? 'Saving…' : 'Save / Override'}
                                    </button>
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
      </div>
    </div>
  );
}
