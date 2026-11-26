'use client';

import Link from 'next/link';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

// ─────────────────────────────── Types ────────────────────────────────────────

interface StatChannel {
  volume: number;
  iqs: number | null;
  csat: number | null;
  solvable_csat_pct?: number | null;
  unsolvable_csat_pct?: number | null;
  solvable_csat?: number | null;
  unsolvable_csat?: number | null;
}

interface CategoryChild {
  name: string;
  iqsChats: number | null;
  iqsCalls?: number | null;
  iqsEmails?: number | null;
  csatChats?: number | null;
  csatCalls?: number | null;
  csatEmails?: number | null;
  resolutionSecs: number | null;
}

interface CategoryRow {
  disposition: string;
  iqsChats: number | null;
  iqsCalls?: number | null;
  iqsEmails?: number | null;
  csatChats?: number | null;
  csatCalls?: number | null;
  csatEmails?: number | null;
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
  wowParams: { chats: WoWParam[]; calls: WoWParam[]; emails?: WoWParam[] };
}

// ─────────────────────────── Helpers ──────────────────────────────────────────

function fmtSecs(s: number | null): string {
  if (s == null || s < 0) return '—';
  const h = s / 3600;
  if (h < 1) return `${h.toFixed(2)}h`;
  return `${h.toFixed(1)}h`;
}

function numOrDash(v: number | null | undefined, suffix = ''): string {
  return v == null ? '—' : `${v}${suffix}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Number(v.toFixed(1))}%`;
}

// ─────────────────────── Icons (inline SVG) ───────────────────────────────────

function DownloadIcon() {
  return (
    <svg style={{ width: 14, height: 14, stroke: 'currentColor', fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
      <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" />
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


// ─────────────────────── Main component ───────────────────────────────────────

interface Props { userEmail?: string; selfAgentName?: string; }

export default function AgentAnalyticsDashboard({ userEmail = '', selfAgentName = '' }: Props) {
  // ── Time range ──────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<'7' | '30' | 'custom'>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const timerangeRef = useRef<HTMLDivElement>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Category expand state ──────────────────────────────────────────────────
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  // ── WoW ─────────────────────────────────────────────────────────────────────
  const [wowChannel, setWowChannel] = useState<'chats' | 'calls' | 'emails'>('chats');
  const [wowTab, setWowTab] = useState<'metrics' | 'params'>('metrics');

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (p: string, from = '', to = '') => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ period: p });
      if (selfAgentName) params.set('agent', selfAgentName);
      if (userEmail) params.set('email', userEmail);
      if (p === 'custom' && from && to) { params.set('from', from); params.set('to', to); }
      const res = await fetch(`/api/quality/my-analytics?${params}`);
      const text = await res.text();
      let d: any;
      try {
        d = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(text || `Server returned ${res.status}`);
      }
      if (!res.ok) throw new Error(d.error || 'Failed to load');
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    }
    setLoading(false);
  }, [selfAgentName, userEmail]);

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
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
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
    const header = ['Category', 'IQS Chats %', 'IQS Calls %', 'IQS Emails %', 'CSAT Chats %', 'CSAT Calls %', 'CSAT Emails %'];
    const rows: string[][] = [header];
    for (const c of data.categories) {
      rows.push([c.disposition, numOrDash(c.iqsChats, '%'), numOrDash(c.iqsCalls, '%'), numOrDash(c.iqsEmails, '%'), numOrDash(c.csatChats, '%'), numOrDash(c.csatCalls, '%'), numOrDash(c.csatEmails, '%')]);
      for (const s of c.children) rows.push([`  ${s.name}`, numOrDash(s.iqsChats, '%'), numOrDash(s.iqsCalls, '%'), numOrDash(s.iqsEmails, '%'), numOrDash(s.csatChats, '%'), numOrDash(s.csatCalls, '%'), numOrDash(s.csatEmails, '%')]);
    }
    exportCsv(rows, 'categories.csv');
  }

  function exportWow() {
    if (!data) return;
    const weeks = data.wowWeeks;
    const metrics = data.wowMetrics[wowChannel];
    const rows: string[][] = [['Metric', ...weeks]];
    rows.push(['CSAT %', ...metrics.csat.map(v => numOrDash(v, '%'))]);
    rows.push(['IQS %', ...metrics.iqs.map(v => numOrDash(v, '%'))]);
    rows.push(['Volume', ...metrics.volume.map(String)]);
    exportCsv(rows, `wow-${wowChannel}.csv`);
  }

  // ── Period label ────────────────────────────────────────────────────────────
  const periodLabel = period === '7' ? 'Last 7 days'
    : period === 'custom' && customFrom && customTo ? `${customFrom} – ${customTo}`
      : 'Last 30 days';

  // ─── Style helper (avoids spreading objects into JSX style) ─────────────────
  const S = (x: any): React.CSSProperties => x;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={S({ display: 'flex', minHeight: 'var(--vh100)', fontFamily: 'var(--qa-sans, -apple-system, BlinkMacSystemFont, "Inter", sans-serif)', fontSize: 14, background: 'var(--qa-bg)', color: 'var(--qa-text)' })}>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main style={S({ flex: 1, minWidth: 0, padding: 32, overflowY: 'auto' })}>

        {(
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
                    const isEmpty = ch === 'emails' ? (c.volume === 0 && c.iqs === null) : (c.volume === 0 && c.iqs === null && c.csat === null);
                    return (
                      <div key={ch} style={S({ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 20, minHeight: 132 })}>
                        <div style={S({ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 12 })}>
                          {ch.charAt(0).toUpperCase() + ch.slice(1)}
                        </div>
                        <div style={S({ display: 'flex', alignItems: 'stretch', gap: 0 })}>
                          {[
                            { label: 'CSAT', value: (isEmpty || c.csat == null) ? '—' : numOrDash(c.csat, '%') },
                            { label: 'IQS', value: (isEmpty || c.iqs == null) ? '—' : numOrDash(c.iqs, '%') },
                            { label: 'Volume', value: isEmpty ? '—' : String(c.volume) },
                          ].map((item, idx) => (
                            <div key={item.label} style={S({ display: 'flex', alignItems: 'stretch' })}>
                              {idx > 0 && <span style={S({ width: 1, alignSelf: 'stretch', background: 'var(--qa-border)', marginTop: 2, marginBottom: 2 })} />}
                              <div style={S({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', lineHeight: 1.1, padding: idx === 0 ? '0 18px 0 0' : '0 18px' })}>
                                <span style={S({ fontSize: 24, fontWeight: 700, color: isEmpty ? 'var(--qa-text-4)' : 'var(--qa-text)', fontFamily: 'ui-monospace, monospace', lineHeight: 1 })}>
                                  {item.value}
                                </span>
                                <span style={S({ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)', marginTop: 8 })}>
                                  {item.label}
                                </span>
                                {item.label === 'CSAT' && ch === 'chats' && (
                                  <div style={S({ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, lineHeight: 1.3 })}>
                                    <div style={S({ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' })}>
                                      <span style={S({ color: 'var(--qa-text-3)', fontSize: 10 })}>Solvable:</span>
                                      <span style={S({ fontWeight: 600, color: (c.solvable_csat_pct ?? c.solvable_csat) != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>
                                        {fmtPct(c.solvable_csat_pct ?? c.solvable_csat)}
                                      </span>
                                    </div>
                                    <div style={S({ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' })}>
                                      <span style={S({ color: 'var(--qa-text-3)', fontSize: 10 })}>Unsolvable:</span>
                                      <span style={S({ fontWeight: 600, color: (c.unsolvable_csat_pct ?? c.unsolvable_csat) != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>
                                        {fmtPct(c.unsolvable_csat_pct ?? c.unsolvable_csat)}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {ch === 'emails' && isEmpty && <div style={S({ fontSize: 13, color: 'var(--qa-text-2)', marginTop: 8 })}>Not yet evaluated</div>}
                      </div>
                    );
                  })}
                </div>

                {/* ── Section: Performance by Category ───────────────────── */}
                <section style={S({ marginBottom: 32 })}>
                  <div style={S({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 })}>
                    <h2 style={S({ fontSize: 18, fontWeight: 600, margin: 0 })}>Performance by Category</h2>
                    <span style={S({ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' })}>
                      {periodLabel}
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
                            <th rowSpan={2} style={S({ width: '28%', height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap', verticalAlign: 'middle', position: 'sticky', top: 0, zIndex: 3 })}>
                              Category
                            </th>
                            <th colSpan={3} style={S({ height: 28, paddingTop: 8, paddingBottom: 0, paddingLeft: 16, paddingRight: 16, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border-sub)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3 })}>
                              IQS
                            </th>
                            <th colSpan={3} style={S({ height: 28, paddingTop: 8, paddingBottom: 0, paddingLeft: 16, paddingRight: 16, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border-sub)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3 })}>
                              CSAT
                            </th>
                          </tr>
                          <tr style={S({ background: 'var(--qa-gray-50)' })}>
                            {['Chats', 'Calls', 'Emails', 'Chats', 'Calls', 'Emails'].map((h, i) => (
                              <th key={`${h}-${i}`} style={S({ height: 34, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', padding: '0 16px', whiteSpace: 'nowrap', position: 'sticky', top: 28, zIndex: 2 })}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.categories.length === 0 && (
                            <tr><td colSpan={7} style={S({ textAlign: 'center', padding: '32px 16px', color: 'var(--qa-text-3)', fontSize: 13 })}>No category data for this period.</td></tr>
                          )}
                          {data.categories.map(cat => {
                            const isOpen = openKeys.has(cat.disposition);
                            return (
                              <Fragment key={cat.disposition}>
                                <tr onClick={() => toggleCategory(cat.disposition)} style={S({ cursor: 'pointer', height: 48, borderBottom: '1px solid var(--qa-border-sub)' })}>
                                  <td style={S({ padding: '0 16px', fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' })}>
                                    <span style={S({ display: 'inline-block', width: 10, height: 10, marginRight: 10, color: 'var(--qa-text-2)', fontSize: 10, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', transformOrigin: 'center' })}>▶</span>
                                    {cat.disposition}
                                  </td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: cat.iqsChats != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(cat.iqsChats, '%')}</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: cat.iqsCalls != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(cat.iqsCalls, '%')}</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: cat.iqsEmails != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(cat.iqsEmails, '%')}</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: cat.csatChats != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(cat.csatChats, '%')}</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: cat.csatCalls != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(cat.csatCalls, '%')}</td>
                                  <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: cat.csatEmails != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(cat.csatEmails, '%')}</td>
                                </tr>
                                {isOpen && cat.children.map(child => (
                                  <tr key={child.name} style={S({ height: 44, borderBottom: '1px solid var(--qa-border-sub)', background: 'var(--qa-gray-50)' })}>
                                    <td style={S({ padding: '0 16px 0 48px', fontSize: 13, color: 'var(--qa-text-2)' })}>{child.name}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: child.iqsChats != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(child.iqsChats, '%')}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: child.iqsCalls != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(child.iqsCalls, '%')}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: child.iqsEmails != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(child.iqsEmails, '%')}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: child.csatChats != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(child.csatChats, '%')}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: child.csatCalls != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(child.csatCalls, '%')}</td>
                                    <td style={S({ padding: '0 16px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: child.csatEmails != null ? 'var(--qa-text)' : 'var(--qa-text-4)' })}>{numOrDash(child.csatEmails, '%')}</td>
                                  </tr>
                                ))}
                              </Fragment>
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
                              { label: 'IQS', vals: data.wowMetrics[wowChannel].iqs, pct: true },
                              { label: 'Volume', vals: data.wowMetrics[wowChannel].volume as (number | null)[], pct: false },
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
                              {data.wowWeeks.map((w) => (
                                <th key={w} style={S({ height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', padding: '0 16px', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 })}>{w}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(wowChannel === 'emails' ? (data.wowParams.emails || []) : wowChannel === 'calls' ? data.wowParams.calls : data.wowParams.chats).map(param => (
                              <tr key={param.name} style={S({ borderBottom: '1px solid var(--qa-border-sub)' })}>
                                <td style={S({ padding: '0 16px', height: 46, fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' })}>{param.name}</td>
                                {param.vals.map((v, i) => (
                                  <td key={i} style={S({ padding: '0 16px', height: 46, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13, color: v == null ? 'var(--qa-text-4)' : 'var(--qa-text)', background: i === param.vals.length - 1 ? 'var(--qa-gray-50)' : 'transparent' })}>
                                    {v == null ? '—' : `${v}%`}
                                  </td>
                                ))}
                              </tr>
                            ))}
                            {wowChannel === 'emails' && (!data.wowParams.emails || data.wowParams.emails.length === 0) && (
                              <tr><td colSpan={data.wowWeeks.length + 1} style={S({ textAlign: 'center', padding: '32px 16px', color: 'var(--qa-text-3)', fontSize: 13 })}>No parameter data for emails in this period.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>

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
