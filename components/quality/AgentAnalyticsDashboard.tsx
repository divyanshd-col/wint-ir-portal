'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

// ─────────────────────────────── Types ────────────────────────────────────────

interface StatChannel {
  volume: number;
  iqs: number | null;
  csat: number | null;
}

interface CategoryChild {
  name: string;
  iqsChats: number | null;
  resolutionSecs: number | null;
}

interface CategoryRow {
  disposition: string;
  iqsChats: number | null;
  resolutionSecs: number | null;
  children: CategoryChild[];
}

interface WoWMetrics {
  csat: (number | null)[];
  iqs: (number | null)[];
  volume: number[];
}

interface WoWParam {
  name: string;
  vals: (number | null)[];
}

interface AnalyticsData {
  statCards: { chats: StatChannel; calls: StatChannel; emails: StatChannel };
  categories: CategoryRow[];
  wowWeeks: string[];
  wowMetrics: { chats: WoWMetrics; calls: WoWMetrics; emails: WoWMetrics };
  wowParams: { chats: WoWParam[]; calls: WoWParam[] };
}

interface AIInsightItem { tag: string; text: string; }
interface AIResult { summary: string; items: AIInsightItem[]; }

// ─────────────────────────── Helpers ──────────────────────────────────────────

function fmtSecs(s: number | null): string {
  if (s == null || s < 0) return '—';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (s < 60) return `${Math.round(s)}s`;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function numOrDash(v: number | null, suffix = ''): string {
  return v == null ? '—' : `${v}${suffix}`;
}

// ─────────────────────── Icons (inline SVG) ───────────────────────────────────

function DownloadIcon() {
  return (
    <svg style={{ width: 14, height: 14, stroke: 'currentColor', fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
      <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" />
    </svg>
  );
}

function StarIcon({ size = 15 }: { size?: number }) {
  return (
    <svg style={{ width: size, height: size, stroke: 'currentColor', fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
      <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <span style={{
      display: 'inline-block', width: 16, height: 16,
      border: '2px solid var(--qa-fill-med)', borderTopColor: 'var(--qa-text)',
      borderRadius: '50%', animation: 'qa-spin 0.7s linear infinite',
    }} />
  );
}

// ─────────────────── Score Log (My Quality Chats) ─────────────────────────────

function ScoreLogView() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/quality/scores?page=0&dateFrom=${from}&skipStats=1`)
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); })
      .catch(() => setError('Failed to load chats'))
      .finally(() => setLoading(false));
  }, []);

  const S = (x: any): React.CSSProperties => x;

  return (
    <div>
      <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 })}>
        <h1 style={S({ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' })}>My Quality Chats</h1>
        <span style={S({ fontSize: 13, color: 'var(--qa-text-3)' })}>Last 30 days</span>
      </div>

      <div style={S({ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' })}>
        {loading && (
          <div style={S({ padding: 48, textAlign: 'center', color: 'var(--qa-text-3)', fontSize: 13 })}>
            <SpinnerIcon /> <span style={S({ marginLeft: 8 })}>Loading…</span>
          </div>
        )}
        {error && <div style={S({ padding: 24, color: '#b91c1c', fontSize: 13 })}>{error}</div>}
        {!loading && !error && (
          <div style={S({ overflowX: 'auto' })}>
            <table style={S({ width: '100%', borderCollapse: 'collapse' })}>
              <thead>
                <tr>
                  {['Chat ID', 'Date', 'IQS', 'CSAT', 'Resolution', 'Disposition'].map(h => (
                    <th key={h} style={S({
                      height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
                      fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)',
                      fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap',
                    })}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr><td colSpan={6} style={S({ textAlign: 'center', padding: '48px 16px', color: 'var(--qa-text-3)', fontSize: 13 })}>No chats found for this period.</td></tr>
                )}
                {entries.map((e, i) => (
                  <tr key={e.id || i} style={S({ borderBottom: '1px solid var(--qa-border-sub)' })}>
                    <td style={S({ padding: '0 16px', height: 46, fontSize: 13, fontFamily: 'var(--qa-mono)', color: '#15803d' })}>{e.chatId}</td>
                    <td style={S({ padding: '0 16px', height: 46, fontSize: 13, color: 'var(--qa-text-2)' })}>{(e.scoredAt || e.date || '').slice(0, 10)}</td>
                    <td style={S({ padding: '0 16px', height: 46, fontSize: 13, fontWeight: 600, color: e.iqs >= 80 ? '#15803d' : e.iqs >= 70 ? '#92400e' : '#b91c1c' })}>{e.iqs != null ? `${e.iqs}%` : '—'}</td>
                    <td style={S({ padding: '0 16px', height: 46, fontSize: 13, color: 'var(--qa-text-2)' })}>{e.csat === '5' ? 'Good' : e.csat === '3' ? 'CBB' : e.csat === '1' ? 'Bad' : '—'}</td>
                    <td style={S({ padding: '0 16px', height: 46, fontSize: 13, color: 'var(--qa-text-2)', fontFamily: 'var(--qa-mono)' })}>{fmtSecs(e.resolutionTime)}</td>
                    <td style={S({ padding: '0 16px', height: 46, fontSize: 13, color: 'var(--qa-text-2)', maxWidth: 180 })}>{e.disposition || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Main component ───────────────────────────────────────

interface Props { userEmail: string; selfAgentName?: string; }

export default function AgentAnalyticsDashboard({ userEmail, selfAgentName }: Props) {
  // ── View state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<'analytics' | 'chats'>('analytics');

  // ── Time range ──────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<'7' | '30' | 'custom'>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const timerangeRef = useRef<HTMLDivElement>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // ── Category expand state ──────────────────────────────────────────────────
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  // ── WoW ─────────────────────────────────────────────────────────────────────
  const [wowChannel, setWowChannel] = useState<'chats' | 'calls' | 'emails'>('chats');
  const [wowTab, setWowTab]         = useState<'metrics' | 'params'>('metrics');

  // ── AI Analysis ─────────────────────────────────────────────────────────────
  const [aiChannel, setAiChannel]     = useState<'chats' | 'calls'>('chats');
  const [aiState, setAiState]         = useState<'empty' | 'loading' | 'insights'>('empty');
  const [aiResults, setAiResults]     = useState<Partial<Record<'chats' | 'calls', AIResult>>>({});
  const [aiGenerating, setAiGenerating] = useState(false);

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (p: string, from = '', to = '') => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ period: p });
      if (p === 'custom' && from && to) { params.set('from', from); params.set('to', to); }
      const res = await fetch(`/api/quality/my-analytics?${params}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to load');
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData('30'); }, [fetchData]);

  // ── Time range handler ──────────────────────────────────────────────────────
  function selectPeriod(p: '7' | '30') {
    setPeriod(p); setShowPicker(false);
    fetchData(p);
  }

  function applyCustom(from: string, to: string) {
    setCustomFrom(from); setCustomTo(to);
    setPeriod('custom'); setShowPicker(false);
    fetchData('custom', from, to);
  }

  // ── Category toggle ─────────────────────────────────────────────────────────
  function toggleCategory(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── CSV export helpers ──────────────────────────────────────────────────────
  function exportCsv(rows: string[][], filename: string) {
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCategories() {
    if (!data) return;
    const header = ['Category', 'IQS Chats %', 'Chat Resolution'];
    const rows: string[][] = [header];
    for (const c of data.categories) {
      rows.push([c.disposition, numOrDash(c.iqsChats, '%'), fmtSecs(c.resolutionSecs)]);
      for (const s of c.children) rows.push([`  ${s.name}`, numOrDash(s.iqsChats, '%'), fmtSecs(s.resolutionSecs)]);
    }
    exportCsv(rows, 'categories.csv');
  }

  function exportWow() {
    if (!data) return;
    const weeks = data.wowWeeks;
    const metrics = data.wowMetrics[wowChannel];
    const rows: string[][] = [['Metric', ...weeks]];
    rows.push(['CSAT %', ...metrics.csat.map(v => numOrDash(v, '%'))]);
    rows.push(['IQS %',  ...metrics.iqs.map(v => numOrDash(v, '%'))]);
    rows.push(['Volume', ...metrics.volume.map(String)]);
    exportCsv(rows, `wow-${wowChannel}.csv`);
  }

  // ── AI Generate ─────────────────────────────────────────────────────────────
  async function generateAI() {
    if (aiGenerating) return;
    setAiGenerating(true);
    setAiState('loading');
    try {
      const body: any = { channel: aiChannel, period };
      if (period === 'custom') { body.from = customFrom; body.to = customTo; }
      const res = await fetch('/api/quality/my-analytics/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) {
        setAiResults(prev => ({ ...prev, [aiChannel]: d }));
        setAiState('insights');
      } else {
        setAiState('empty');
      }
    } catch { setAiState('empty'); }
    setAiGenerating(false);
  }

  // ── Period label ────────────────────────────────────────────────────────────
  const periodLabel = period === '7' ? 'Last 7 days'
    : period === 'custom' && customFrom && customTo ? `${customFrom} – ${customTo}`
    : 'Last 30 days';

  // ─── Style helper (avoids spreading objects into JSX style) ─────────────────
  const S = (x: any): React.CSSProperties => x;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={S({ display: 'flex', minHeight: '100vh', fontFamily: 'var(--qa-sans, -apple-system, BlinkMacSystemFont, "Inter", sans-serif)', fontSize: 14, background: 'var(--qa-bg)', color: 'var(--qa-text)' })}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={S({
        width: 220, flexShrink: 0,
        background: 'var(--qa-card)', borderRight: '1px solid var(--qa-border)',
        padding: '16px 0', minHeight: '100vh', position: 'sticky', top: 0,
      })}>
        <div style={S({ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', padding: '12px 16px 6px' })}>
          Agent
        </div>

        {(['analytics', 'chats'] as const).map(v => {
          const label = v === 'analytics' ? 'My Analytics' : 'My Quality Chats';
          const active = view === v;
          return (
            <button key={v} onClick={() => setView(v)} style={S({
              width: '100%', height: 44, padding: '0 16px',
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 14, color: active ? 'var(--qa-text)' : 'var(--qa-text-2)',
              cursor: 'pointer', position: 'relative', textAlign: 'left',
              background: active ? 'var(--qa-gray-100)' : 'transparent',
              border: 0, borderLeft: active ? '3px solid var(--qa-text)' : '3px solid transparent',
              fontWeight: active ? 500 : 400, fontFamily: 'inherit',
            })}>
              <span style={S({
                width: 16, height: 16, border: `1px solid ${active ? 'var(--qa-text)' : 'var(--qa-text-3)'}`,
                borderRadius: 3, flexShrink: 0,
                background: active ? 'var(--qa-fill-med)' : 'transparent',
              })} />
              {label}
            </button>
          );
        })}
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main style={S({ flex: 1, minWidth: 0, padding: 32, overflowY: 'auto' })}>

        {view === 'chats' && <ScoreLogView />}

        {view === 'analytics' && (
          <>
            {/* Page header */}
            <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 })}>
              <h1 style={S({ fontSize: 24, fontWeight: 600, margin: 0 })}>My Analytics</h1>

              {/* Time range + date picker */}
              <div ref={timerangeRef} style={S({ position: 'relative' })}>
                <div style={S({ display: 'inline-flex', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--qa-card)' })}>
                  {(['7', '30'] as const).map(p => (
                    <button key={p} onClick={() => selectPeriod(p)} style={S({
                      height: 32, padding: '0 14px', background: period === p ? 'var(--qa-text)' : 'transparent',
                      border: 0, borderRight: '1px solid var(--qa-border)',
                      fontSize: 13, color: period === p ? '#fff' : 'var(--qa-text-2)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    })}>
                      {p === '7' ? '7 days' : '30 days'}
                    </button>
                  ))}
                  <button onClick={() => setShowPicker(v => !v)} style={S({
                    height: 32, padding: '0 14px', background: period === 'custom' ? 'var(--qa-text)' : 'transparent',
                    border: 0, fontSize: 13, color: period === 'custom' ? '#fff' : 'var(--qa-text-2)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  })}>
                    {period === 'custom' && customFrom ? `${customFrom} – ${customTo}` : 'Custom range'}
                  </button>
                </div>
                {showPicker && (
                  <DateRangePicker
                    onApply={(from, to) => applyCustom(from, to)}
                    onCancel={() => setShowPicker(false)}
                  />
                )}
              </div>
            </div>

            {loading && (
              <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 10, color: 'var(--qa-text-2)', fontSize: 13 })}>
                <SpinnerIcon /> Loading…
              </div>
            )}

            {error && !loading && (
              <div style={S({ background: '#fee2e2', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', color: '#b91c1c', fontSize: 13, marginBottom: 24 })}>
                {error}
              </div>
            )}

            {!loading && data && (
              <>
                {/* ── Stat cards ─────────────────────────────────────────── */}
                <div style={S({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 })}>
                  {(['chats', 'calls', 'emails'] as const).map(ch => {
                    const c = data.statCards[ch];
                    const isEmpty = ch === 'emails';
                    return (
                      <div key={ch} style={S({ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 20, minHeight: 132 })}>
                        <div style={S({ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 12 })}>
                          {ch.charAt(0).toUpperCase() + ch.slice(1)}
                        </div>
                        <div style={S({ display: 'flex', alignItems: 'flex-end', gap: 0 })}>
                          {[
                            { label: 'CSAT', value: isEmpty ? '—' : numOrDash(c.csat, '%') },
                            { label: 'IQS',  value: isEmpty ? '—' : numOrDash(c.iqs, '%') },
                            { label: 'Volume', value: isEmpty ? '—' : String(c.volume) },
                          ].map((item, idx) => (
                            <div key={item.label} style={S({ display: 'flex', alignItems: 'stretch' })}>
                              {idx > 0 && <span style={S({ width: 1, alignSelf: 'stretch', background: 'var(--qa-border)' })} />}
                              <div style={S({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1, padding: idx === 0 ? '0 18px 0 0' : '0 18px' })}>
                                <span style={S({ fontSize: 24, fontWeight: 700, color: isEmpty ? 'var(--qa-text-4)' : 'var(--qa-text)', fontFamily: 'ui-monospace, monospace', lineHeight: 1 })}>
                                  {item.value}
                                </span>
                                <span style={S({ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)', marginTop: 8 })}>
                                  {item.label}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {isEmpty && <div style={S({ fontSize: 13, color: 'var(--qa-text-2)', marginTop: 8 })}>Not yet evaluated</div>}
                      </div>
                    );
                  })}
                </div>

                {/* ── Section: Performance by Category ───────────────────── */}
                <section style={S({ marginBottom: 32 })}>
                  <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 })}>
                    <h2 style={S({ fontSize: 18, fontWeight: 600, margin: 0 })}>Performance by Category</h2>
                    <span style={S({ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' })}>
                      {periodLabel} · click a row to expand subcategories
                    </span>
                  </div>

                  <div style={S({ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' })}>
                    {/* Panel header */}
                    <div style={S({ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--qa-border)' })}>
                      <span style={S({ fontSize: 14, fontWeight: 500 })}>Top categories by volume</span>
                      <button onClick={exportCategories} title="Export as CSV" style={S({ width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6, background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' })}>
                        <DownloadIcon />
                      </button>
                    </div>

                    {/* Table */}
                    <div style={S({ overflowY: 'auto', maxHeight: 308 })}>
                      <table style={S({ width: '100%', borderCollapse: 'collapse' })}>
                        <thead>
                          <tr style={S({ background: 'var(--qa-gray-50)' })}>
                            <th rowSpan={2} style={S({ width: '38%', height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap', verticalAlign: 'middle', position: 'sticky', top: 0, zIndex: 3 })}>
                              Category
                            </th>
                            <th colSpan={2} style={S({ height: 28, paddingTop: 8, paddingBottom: 0, paddingLeft: 16, paddingRight: 16, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border-sub)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3 })}>
                              IQS
                            </th>
                            <th rowSpan={2} style={S({ height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', padding: '0 16px', whiteSpace: 'nowrap', verticalAlign: 'middle', position: 'sticky', top: 0, zIndex: 3 })}>
                              Chat Resolution
                            </th>
                          </tr>
                          <tr style={S({ background: 'var(--qa-gray-50)' })}>
                            {['Chats', 'Calls'].map(h => (
                              <th key={h} style={S({ height: 34, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', padding: '0 16px', whiteSpace: 'nowrap', position: 'sticky', top: 28, zIndex: 2 })}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.categories.length === 0 && (
                            <tr><td colSpan={4} style={S({ textAlign: 'center', padding: '32px 16px', color: 'var(--qa-text-3)', fontSize: 13 })}>No category data for this period.</td></tr>
                          )}
                          {data.categories.map(cat => {
                            const isOpen = openKeys.has(cat.disposition);
                            return (
                              <>
                                <tr key={cat.disposition} onClick={() => toggleCategory(cat.disposition)} style={S({ cursor: 'pointer', height: 48, borderBottom: '1px solid var(--qa-border-sub)' })}>
                                  <td style={S({ padding: '0 16px', fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' })}>
                                    <span style={S({ display: 'inline-block', width: 10, height: 10, marginRight: 10, color: 'var(--qa-text-2)', fontSize: 10, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', transformOrigin: 'center' })}>▶</span>
                                    {cat.disposition}
                                  </td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text)' })}>{numOrDash(cat.iqsChats, '%')}</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text-4)' })}>—</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text)' })}>{fmtSecs(cat.resolutionSecs)}</td>
                                </tr>
                                {isOpen && cat.children.map(child => (
                                  <tr key={child.name} style={S({ height: 44, borderBottom: '1px solid var(--qa-border-sub)', background: 'var(--qa-gray-50)' })}>
                                    <td style={S({ padding: '0 16px 0 48px', fontSize: 13, color: 'var(--qa-text-2)' })}>{child.name}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text)' })}>{numOrDash(child.iqsChats, '%')}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text-4)' })}>—</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text)' })}>{fmtSecs(child.resolutionSecs)}</td>
                                  </tr>
                                ))}
                              </>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                {/* ── Section: Week-on-Week ────────────────────────────────── */}
                <section style={S({ marginBottom: 32 })}>
                  <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 })}>
                    <h2 style={S({ fontSize: 18, fontWeight: 600, margin: 0 })}>Week-on-Week Performance</h2>
                    <span style={S({ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' })}>Trailing 5 weeks</span>
                  </div>

                  <div style={S({ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' })}>
                    {/* Panel header: tabs + channel + export */}
                    <div style={S({ padding: '0 12px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--qa-border)' })}>
                      <div style={S({ display: 'flex', gap: 4 })}>
                        {([['metrics', 'CSAT + IQS + Volume'], ['params', 'IQS by Parameter']] as const).map(([key, label]) => (
                          <button key={key} onClick={() => setWowTab(key)} style={S({
                            height: 48, padding: '0 16px', background: 'transparent', border: 0,
                            fontSize: 13, color: wowTab === key ? 'var(--qa-text)' : 'var(--qa-text-2)',
                            cursor: 'pointer', fontFamily: 'inherit', fontWeight: wowTab === key ? 600 : 400,
                            borderBottom: wowTab === key ? '2px solid var(--qa-text)' : '2px solid transparent',
                            marginBottom: -1,
                          })}>{label}</button>
                        ))}
                      </div>
                      <div style={S({ display: 'flex', alignItems: 'center', gap: 10 })}>
                        {/* Channel segmented control */}
                        <span style={S({ display: 'inline-flex', alignItems: 'center', gap: 2, height: 30, padding: '3px 3px 3px 0', background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 })}>
                          <span style={S({ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', padding: '0 10px 0 12px', userSelect: 'none' })}>Channel</span>
                          {(['chats', 'calls', 'emails'] as const).map(ch => (
                            <button key={ch} onClick={() => setWowChannel(ch)} style={S({
                              appearance: 'none', border: 0,
                              background: wowChannel === ch ? 'var(--qa-text)' : 'transparent',
                              fontFamily: 'inherit', fontSize: 13,
                              color: wowChannel === ch ? '#fff' : 'var(--qa-text-2)',
                              height: 24, padding: '0 13px', borderRadius: 6, cursor: 'pointer',
                              fontWeight: wowChannel === ch ? 500 : 400,
                            })}>
                              {ch.charAt(0).toUpperCase() + ch.slice(1)}
                            </button>
                          ))}
                        </span>
                        <button onClick={exportWow} title="Export as CSV" style={S({ width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6, background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
                          <DownloadIcon />
                        </button>
                      </div>
                    </div>

                    {/* Tab 1: Metrics */}
                    {wowTab === 'metrics' && (
                      <div style={S({ overflowX: 'auto' })}>
                        <table style={S({ width: '100%', borderCollapse: 'collapse' })}>
                          <thead>
                            <tr>
                              <th style={S({ height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap' })}>Metric</th>
                              {data.wowWeeks.map((w, i) => (
                                <th key={w} style={S({ height: 40, background: i === data.wowWeeks.length - 1 ? 'var(--qa-gray-50)' : 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', padding: '0 16px', whiteSpace: 'nowrap' })}>{w}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { label: 'CSAT %', vals: data.wowMetrics[wowChannel].csat, pct: true },
                              { label: 'IQS',    vals: data.wowMetrics[wowChannel].iqs,  pct: true },
                              { label: 'Volume', vals: data.wowMetrics[wowChannel].volume as (number|null)[], pct: false },
                            ].map(row => (
                              <tr key={row.label} style={S({ borderBottom: '1px solid var(--qa-border-sub)' })}>
                                <td style={S({ padding: '0 16px', height: 46, fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' })}>{row.label}</td>
                                {row.vals.map((v, i) => (
                                  <td key={i} style={S({ padding: '0 16px', height: 46, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: v == null ? 'var(--qa-text-4)' : 'var(--qa-text)', background: i === row.vals.length - 1 ? 'var(--qa-gray-50)' : 'transparent' })}>
                                    {v == null ? '—' : row.pct ? `${v}%` : String(v)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Tab 2: IQS by Parameter */}
                    {wowTab === 'params' && (
                      <div style={S({ overflowY: 'auto', maxHeight: 322, overflowX: 'auto' })}>
                        <table style={S({ width: '100%', borderCollapse: 'collapse' })}>
                          <thead>
                            <tr>
                              <th style={S({ height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 })}>Parameter</th>
                              {data.wowWeeks.map((w, i) => (
                                <th key={w} style={S({ height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', padding: '0 16px', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 })}>{w}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(wowChannel === 'emails' ? [] : wowChannel === 'calls' ? data.wowParams.calls : data.wowParams.chats).map(param => (
                              <tr key={param.name} style={S({ borderBottom: '1px solid var(--qa-border-sub)' })}>
                                <td style={S({ padding: '0 16px', height: 46, fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' })}>{param.name}</td>
                                {param.vals.map((v, i) => (
                                  <td key={i} style={S({ padding: '0 16px', height: 46, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: v == null ? 'var(--qa-text-4)' : 'var(--qa-text)', background: i === param.vals.length - 1 ? 'var(--qa-gray-50)' : 'transparent' })}>
                                    {v == null ? '—' : `${v}%`}
                                  </td>
                                ))}
                              </tr>
                            ))}
                            {wowChannel === 'emails' && (
                              <tr><td colSpan={data.wowWeeks.length + 1} style={S({ textAlign: 'center', padding: '32px 16px', color: 'var(--qa-text-3)', fontSize: 13 })}>Email quality scoring coming soon.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>

                {/* ── Section: AI Analysis ─────────────────────────────────── */}
                <section style={S({ marginBottom: 32 })}>
                  <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 })}>
                    <h2 style={S({ fontSize: 18, fontWeight: 600, margin: 0 })}>AI Analysis</h2>
                  </div>

                  <div style={S({ background: 'var(--qa-gray-50)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 24 })}>
                    {/* AI card header */}
                    <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 })}>
                      <h3 style={S({ fontSize: 18, fontWeight: 600, margin: 0 })}>AI Analysis</h3>
                      <button onClick={generateAI} disabled={aiGenerating} style={S({
                        height: 36, padding: '0 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
                        fontWeight: 500, cursor: aiGenerating ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        border: '1px solid var(--qa-text)', background: aiGenerating ? 'var(--qa-fill-med)' : 'var(--qa-text)',
                        color: aiGenerating ? 'var(--qa-text-3)' : '#fff',
                      })}>
                        <StarIcon size={15} />
                        {aiResults[aiChannel] ? 'Regenerate' : 'Generate Analysis'}
                      </button>
                    </div>

                    {/* AI channel tabs */}
                    <div style={S({ display: 'flex', gap: 4, borderBottom: '1px solid var(--qa-border)', marginBottom: 20 })}>
                      {(['chats', 'calls'] as const).map(ch => (
                        <button key={ch} onClick={() => {
                          setAiChannel(ch);
                          setAiState(aiResults[ch] ? 'insights' : 'empty');
                        }} style={S({
                          height: 36, padding: '0 14px', background: 'transparent', border: 0,
                          fontSize: 13, color: aiChannel === ch ? 'var(--qa-text)' : 'var(--qa-text-2)',
                          cursor: 'pointer', fontFamily: 'inherit', fontWeight: aiChannel === ch ? 600 : 400,
                          borderBottom: aiChannel === ch ? '2px solid var(--qa-text)' : '2px solid transparent',
                          marginBottom: -1,
                        })}>{ch.charAt(0).toUpperCase() + ch.slice(1)}</button>
                      ))}
                      <button disabled title="Coming soon" style={S({
                        height: 36, padding: '0 14px', background: 'transparent', border: 0,
                        fontSize: 13, color: 'var(--qa-text-4)', cursor: 'not-allowed', fontFamily: 'inherit',
                        borderBottom: '2px solid transparent', marginBottom: -1,
                      })}>Emails</button>
                    </div>

                    {/* Loading state */}
                    {aiState === 'loading' && (
                      <div style={S({ display: 'flex', alignItems: 'center', gap: 10, minHeight: 160, justifyContent: 'center', color: 'var(--qa-text-2)', fontSize: 13 })}>
                        <SpinnerIcon />
                        Analyzing your {aiChannel}…
                      </div>
                    )}

                    {/* Empty state */}
                    {aiState === 'empty' && (
                      <div style={S({ minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' })}>
                        <StarIcon size={28} />
                        <p style={S({ fontSize: 13, color: 'var(--qa-text-3)', margin: 0, maxWidth: 340 })}>
                          Click <strong>Generate Analysis</strong> to get AI-powered performance insights.
                        </p>
                      </div>
                    )}

                    {/* Insights */}
                    {aiState === 'insights' && aiResults[aiChannel] && (() => {
                      const result = aiResults[aiChannel]!;
                      return (
                        <div>
                          <p style={S({ fontSize: 14, color: 'var(--qa-text)', lineHeight: 1.55, margin: '0 0 18px', maxWidth: 760 })}>
                            {result.summary}
                          </p>
                          <div style={S({ display: 'flex', flexDirection: 'column', gap: 12 })}>
                            {result.items.map((item, i) => {
                              const tagStyle = item.tag === 'Strength'
                                ? { background: 'var(--qa-text)', color: '#fff' }
                                : item.tag === 'Watch'
                                ? { background: 'var(--qa-fill-med)', color: 'var(--qa-text)' }
                                : { background: 'var(--qa-card)', color: 'var(--qa-text-2)', border: '1px solid var(--qa-border)' };
                              return (
                                <div key={i} style={S({ display: 'flex', gap: 12, padding: '14px 16px', background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 })}>
                                  <span style={S({ flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', ...tagStyle })}>
                                    {item.tag}
                                  </span>
                                  <span style={S({ fontSize: 13, color: 'var(--qa-text)', lineHeight: 1.5 })}>{item.text}</span>
                                </div>
                              );
                            })}
                          </div>
                          <p style={S({ marginTop: 16, fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' })}>
                            Generated from your evaluated {aiChannel} · {periodLabel}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </section>

                <p style={S({ margin: '0 0 16px', fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' })}>
                  Scores &amp; volumes reflect evaluated conversations · {periodLabel}
                </p>
              </>
            )}
          </>
        )}
      </main>

      {/* Spinner keyframe — injected via style tag */}
      <style>{`@keyframes qa-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
