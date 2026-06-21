'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { IQSScoreEntry } from '@/lib/quality';
import IRScorePanel from './IRScorePanel';

// ─── Styles ──────────────────────────────────────────────────────────────────

const css: Record<string, CSSProperties> = {
  page: { padding: '28px 32px', maxWidth: 1100 },
  heading: { fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 4 },
  subheading: { fontSize: 13, color: '#6B7280', marginBottom: 24 },
  section: { marginBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#111', marginBottom: 14 },
  card: { background: '#fff', border: '1px solid #E4E4E7', borderRadius: 10, overflow: 'hidden' },
  filterBar: { padding: '14px 18px', borderBottom: '1px solid #E4E4E7', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', background: '#FAFAFB' },
  select: { fontSize: 12, padding: '6px 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#111', cursor: 'pointer', outline: 'none' },
  dateInput: { fontSize: 12, padding: '5px 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#111', outline: 'none' },
  applyBtn: { fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2D2D31', color: '#fff', cursor: 'pointer', fontWeight: 500 },
  resetBtn: { fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer' },
  count: { fontSize: 12, color: '#6B7280', marginLeft: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 16px', textAlign: 'left', borderBottom: '1px solid #E4E4E7', background: '#FAFAFB' },
  td: { fontSize: 13, color: '#111', padding: '11px 16px', borderBottom: '1px solid #F3F4F6', verticalAlign: 'middle' },
  viewBtn: { fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151', fontWeight: 500 },
  cancelBtn: { fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #DC2626', background: '#fff', cursor: 'pointer', color: '#DC2626', fontWeight: 500, marginRight: 6 },
  tabRow: { display: 'flex', gap: 0, borderBottom: '1px solid #E4E4E7', background: '#FAFAFB', padding: '0 18px' },
  emptyRow: { textAlign: 'center', color: '#9CA3AF', fontSize: 13, padding: '32px 0' },
};

function tabStyle(active: boolean): CSSProperties {
  return { fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#111' : '#6B7280', padding: '10px 16px', cursor: 'pointer', borderBottom: active ? '2px solid #111' : '2px solid transparent', marginBottom: -1, background: 'none', border: 'none', outline: 'none' };
}
function badgeStyle(color: string, bg: string): CSSProperties {
  return { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: bg, color };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisputeRow {
  flagId: string;
  chatId: string;
  iqsScore: number | null;
  closedAt: string;
  status: string;
  paramCategory: string;
  challengedParams: { param: string; note: string }[];
  agentNote: string;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
  parameters: Record<string, any> | null;
  flaggedAt: string;
}

interface Props {
  userEmail: string;
  agentName: string;
}

// ─── IQS badge ───────────────────────────────────────────────────────────────

function IQSBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span style={{ color: '#9CA3AF' }}>—</span>;
  const color = score >= 85 ? '#16A34A' : score >= 75 ? '#CA8A04' : score >= 60 ? '#EA580C' : '#DC2626';
  return <span style={{ fontWeight: 600, color }}>{score}</span>;
}

// ─── Section A: Evaluated Chats ───────────────────────────────────────────────

function EvaluatedSection({ agentName }: { agentName: string }) {
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filter state
  const [disposition, setDisposition] = useState('');
  const [subDisposition, setSubDisposition] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [csat, setCsat] = useState('');
  const [qualityParam, setQualityParam] = useState('');

  // Available filter options (from API)
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [subDispositions, setSubDispositions] = useState<string[]>([]);
  const [dispositionSubMap, setDispositionSubMap] = useState<Record<string, string[]>>({});

  // Applied filters
  const [applied, setApplied] = useState({ disposition: '', subDisposition: '', dateFrom: '', dateTo: '', csat: '', qualityParam: '' });

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async (filters: typeof applied) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ agent: agentName, page: '0', skipStats: '1' });
      if (filters.disposition) p.set('tag', filters.disposition);
      if (filters.subDisposition) p.set('subTag', filters.subDisposition);
      if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) p.set('dateTo', filters.dateTo);
      if (filters.csat) p.set('csat', filters.csat);
      const res = await fetch(`/api/quality/scores?${p}`);
      const data = await res.json();
      const rows: IQSScoreEntry[] = Array.isArray(data.entries) ? data.entries : [];

      // Client-side filter by failed quality parameter
      const filtered = filters.qualityParam
        ? rows.filter(e => e.scores?.[filters.qualityParam] === 'No')
        : rows;

      setEntries(filtered);
      setTotal(data.total ?? filtered.length);

      if (data.availableDispositions) setDispositions(data.availableDispositions);
      if (data.dispositionSubMap) setDispositionSubMap(data.dispositionSubMap);
      if (data.availableSubDispositions) setSubDispositions(data.availableSubDispositions);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [agentName]);

  useEffect(() => { fetchData(applied); }, [fetchData, applied]);

  const handleApply = () => {
    setApplied({ disposition, subDisposition, dateFrom, dateTo, csat, qualityParam });
    setExpandedId(null);
  };

  const handleReset = () => {
    setDisposition(''); setSubDisposition(''); setDateFrom(''); setDateTo(''); setCsat(''); setQualityParam('');
    setApplied({ disposition: '', subDisposition: '', dateFrom: '', dateTo: '', csat: '', qualityParam: '' });
    setExpandedId(null);
  };

  const subDispsForPicked = disposition && dispositionSubMap[disposition] ? dispositionSubMap[disposition] : subDispositions;

  const PARAM_NAMES_FLAT = [
    { key: 'Technical', label: 'Technically / Legally Correct' },
    { key: 'AllQuestions', label: 'All Questions Answered' },
    { key: 'Expectation', label: 'Expectation Setting' },
    { key: 'Contextual', label: 'Contextual & Personal' },
    { key: 'FollowUp', label: 'Follow-up & Closing' },
    { key: 'Sentences', label: 'Sentences / Tone' },
    { key: 'Process', label: 'Process-wise' },
    { key: 'Opening', label: 'First Response & Opening' },
    { key: 'Call', label: 'Call (when required)' },
    { key: 'Grammar', label: 'Grammar / Structure' },
    { key: 'Empathy', label: 'Empathy' },
  ];

  return (
    <div style={css.section}>
      <div style={css.sectionTitle}>My Evaluated Chats</div>
      <div style={css.card}>
        {/* Filter bar */}
        <div style={css.filterBar}>
          <select style={css.select} value={disposition} onChange={e => { setDisposition(e.target.value); setSubDisposition(''); }}>
            <option value="">All Dispositions</option>
            {dispositions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select style={css.select} value={subDisposition} onChange={e => setSubDisposition(e.target.value)} disabled={!subDispsForPicked.length}>
            <option value="">All Sub-dispositions</option>
            {subDispsForPicked.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="date" style={css.dateInput} value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From" />
          <input type="date" style={css.dateInput} value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To" />
          <select style={css.select} value={csat} onChange={e => setCsat(e.target.value)}>
            <option value="">All CSAT</option>
            <option value="5">Good (5)</option>
            <option value="3">CBB (3)</option>
            <option value="1">Bad (1)</option>
          </select>
          <select style={css.select} value={qualityParam} onChange={e => setQualityParam(e.target.value)}>
            <option value="">All Parameters</option>
            {PARAM_NAMES_FLAT.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button style={css.applyBtn} onClick={handleApply}>Apply</button>
          <button style={css.resetBtn} onClick={handleReset}>Reset</button>
          <span style={css.count}>Showing {entries.length} chats</span>
        </div>

        {/* Table */}
        <table style={css.table}>
          <thead>
            <tr>
              <th style={css.th}>Chat ID</th>
              <th style={css.th}>IQS</th>
              <th style={css.th}>Date</th>
              <th style={css.th}>CSAT</th>
              <th style={css.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={css.emptyRow}>Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} style={css.emptyRow}>No evaluated chats found</td></tr>
            ) : entries.map(e => {
              const isOpen = expandedId === e.id;
              return (
                <>
                  <tr key={e.id} style={{ background: isOpen ? '#F9FAFB' : '#fff' }}>
                    <td style={css.td}><span style={{ fontSize: 12, fontFamily: 'monospace', color: '#374151' }}>{e.chatId?.slice(0, 16)}…</span></td>
                    <td style={css.td}><IQSBadge score={e.iqs} /></td>
                    <td style={css.td}>{e.date || '—'}</td>
                    <td style={css.td}>{e.csat ? csatLabel(e.csat) : '—'}</td>
                    <td style={css.td}>
                      <button style={css.viewBtn} onClick={() => setExpandedId(isOpen ? null : e.id)}>
                        {isOpen ? 'Close ▲' : 'View ▾'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <IRScorePanel
                      key={`panel-${e.id}`}
                      chatId={e.chatId}
                      agentName={e.agentName}
                      iqsScore={e.iqs}
                      closedAt={e.date || e.scoredAt}
                      parameters={buildParams(e)}
                      mode="evaluated"
                      colSpan={5}
                      onClose={() => setExpandedId(null)}
                      onDisputeRaised={() => { /* no-op, stay on page */ }}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section B: My Disputes ────────────────────────────────────────────────────

function DisputesSection() {
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending');
  const [pending, setPending] = useState<DisputeRow[]>([]);
  const [reviewed, setReviewed] = useState<DisputeRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingReviewed, setLoadingReviewed] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    setLoadingPending(true);
    setLoadingReviewed(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/ir/disputes?status=pending'),
        fetch('/api/ir/disputes?status=resolved'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);
      setPending(Array.isArray(pData.disputes) ? pData.disputes : []);
      setReviewed(Array.isArray(rData.disputes) ? rData.disputes : []);
    } catch {
      setPending([]);
      setReviewed([]);
    } finally {
      setLoadingPending(false);
      setLoadingReviewed(false);
    }
  }, []);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const cancelDispute = async (flagId: string) => {
    setCancelling(flagId);
    try {
      await fetch('/api/quality/flag', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: flagId, status: 'cancelled', action: 'cancel' }),
      });
      await fetchDisputes();
    } catch {
    } finally {
      setCancelling(null);
    }
  };

  const rows = tab === 'pending' ? pending : reviewed;
  const loading = tab === 'pending' ? loadingPending : loadingReviewed;

  const pendingCols = 5;
  const reviewedCols = 5;
  const colSpan = tab === 'pending' ? pendingCols : reviewedCols;

  return (
    <div style={css.section}>
      <div style={css.sectionTitle}>My Disputes</div>
      <div style={css.card}>
        <div style={css.tabRow}>
          <button style={tabStyle(tab === 'pending')} onClick={() => { setTab('pending'); setExpandedId(null); }}>
            Pending {pending.length > 0 && <span style={{ marginLeft: 4, fontSize: 11, background: '#FEF3C7', color: '#92400E', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>{pending.length}</span>}
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => { setTab('reviewed'); setExpandedId(null); }}>
            Reviewed
          </button>
        </div>

        <table style={css.table}>
          <thead>
            <tr>
              <th style={css.th}>Chat ID</th>
              <th style={css.th}>IQS</th>
              <th style={css.th}>Date Raised</th>
              {tab === 'pending' && <th style={css.th}>Status</th>}
              {tab === 'reviewed' && <th style={css.th}>Outcome</th>}
              <th style={css.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} style={css.emptyRow}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={colSpan} style={css.emptyRow}>No {tab} disputes</td></tr>
            ) : rows.map(row => {
              const isOpen = expandedId === row.flagId;
              return (
                <>
                  <tr key={row.flagId} style={{ background: isOpen ? '#F9FAFB' : '#fff' }}>
                    <td style={css.td}><span style={{ fontSize: 12, fontFamily: 'monospace', color: '#374151' }}>{row.chatId?.slice(0, 16)}…</span></td>
                    <td style={css.td}><IQSBadge score={row.iqsScore} /></td>
                    <td style={css.td}>{row.flaggedAt ? new Date(row.flaggedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    {tab === 'pending' && (
                      <td style={css.td}>
                        <span style={badgeStyle(
                          row.status === 'ir_pending_tl' ? '#92400E' : '#1D4ED8',
                          row.status === 'ir_pending_tl' ? '#FEF3C7' : '#DBEAFE',
                        )}>
                          {row.status === 'ir_pending_tl' ? 'Raised' : 'Under Review'}
                        </span>
                      </td>
                    )}
                    {tab === 'reviewed' && (
                      <td style={css.td}>
                        <span style={badgeStyle(
                          row.status === 'tl_resolved' ? '#065F46' : (row.reviewNote?.includes('reject') ? '#991B1B' : '#065F46'),
                          row.status === 'tl_resolved' ? '#D1FAE5' : (row.reviewNote?.includes('reject') ? '#FEE2E2' : '#D1FAE5'),
                        )}>
                          {row.status === 'tl_resolved' ? 'TL Resolved' : (row.reviewNote?.includes('reject') ? 'Rejected' : 'Accepted')}
                        </span>
                      </td>
                    )}
                    <td style={css.td}>
                      {tab === 'pending' && row.status === 'ir_pending_tl' && (
                        <button
                          style={css.cancelBtn}
                          disabled={cancelling === row.flagId}
                          onClick={() => cancelDispute(row.flagId)}
                        >
                          {cancelling === row.flagId ? 'Cancelling…' : 'Cancel Dispute'}
                        </button>
                      )}
                      <button style={css.viewBtn} onClick={() => setExpandedId(isOpen ? null : row.flagId)}>
                        {isOpen ? 'Close ▲' : 'View ▾'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <IRScorePanel
                      key={`panel-${row.flagId}`}
                      chatId={row.chatId}
                      agentName=""
                      iqsScore={row.iqsScore}
                      closedAt={row.closedAt}
                      parameters={row.parameters}
                      mode={tab === 'pending' ? 'pending' : 'reviewed'}
                      challengedParams={row.challengedParams}
                      reviewNote={row.reviewNote}
                      reviewedBy={row.reviewedBy}
                      flagId={row.flagId}
                      colSpan={colSpan}
                      onClose={() => setExpandedId(null)}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function csatLabel(csat: string) {
  if (csat === '5') return <span style={{ color: '#16A34A', fontWeight: 500 }}>Good</span>;
  if (csat === '3') return <span style={{ color: '#CA8A04', fontWeight: 500 }}>CBB</span>;
  if (csat === '1') return <span style={{ color: '#DC2626', fontWeight: 500 }}>Bad</span>;
  return csat;
}

function buildParams(e: IQSScoreEntry): Record<string, { score: boolean | null; reasoning: string }> {
  const out: Record<string, { score: boolean | null; reasoning: string }> = {};
  for (const [k, v] of Object.entries(e.scores || {})) {
    out[k] = { score: v === 'Yes' ? true : v === 'No' ? false : null, reasoning: e.reasoning?.[k] || '' };
  }
  return out;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MyQualityChatsPage({ userEmail, agentName }: Props) {
  return (
    <div style={css.page}>
      <div style={css.heading}>My Quality Chats</div>
      <div style={css.subheading}>Review your scored chats, raise disputes, and track dispute outcomes.</div>

      <EvaluatedSection agentName={agentName} />
      <DisputesSection />
    </div>
  );
}
