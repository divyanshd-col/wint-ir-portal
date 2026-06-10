'use client';
import { useState, useEffect, useCallback } from 'react';
import PendingReviewCard from './PendingReviewCard';
import IQSRingCard from './IQSRingCard';
import DispositionTreeTable from './DispositionTreeTable';
import WoWTrendChart from './WoWTrendChart';
import DateRangePicker from './DateRangePicker';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DispositionRow {
  disposition:    string;
  count:          number;
  pct:            number | null;
  csatChat:       number | null;
  csatCall:       number | null;
  csatEmail:      null;
  aiChatCsat:     number | null;
  pctDeflected:   number | null;
  iqsChat:        number | null;
  iqsCall:        number | null;
  iqsEmail:       null;
  resolutionSecs: number | null;
  children: SubDispositionRow[];
}

export interface SubDispositionRow {
  subDisposition: string;
  count:          number;
  pct:            number | null;
  csatChat:       number | null;
  csatCall:       number | null;
  csatEmail:      null;
  aiChatCsat:     number | null;
  pctDeflected:   number | null;
  iqsChat:        number | null;
  iqsCall:        number | null;
  iqsEmail:       null;
  resolutionSecs: number | null;
}

export interface AnalyticsData {
  pending: { total: number; chats: number; calls: number; emails: number };
  iqs:     { chat: number | null; call: number | null; email: null };
  byDisposition: DispositionRow[];
}

export type Period = '7' | '30' | 'custom';

// ── Component ─────────────────────────────────────────────────────────────

export default function QAAnalyticsDashboard() {
  const [period, setPeriod]     = useState<Period>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  function fmtDate(iso: string) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  const periodLabel = period === '7' ? 'Last 7 days'
    : period === 'custom' && customFrom && customTo
      ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}`
      : 'Last 30 days';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let url = `/api/cx/qa/analytics?period=${period}`;
      if (period === 'custom' && customFrom && customTo) {
        url += `&from=${customFrom}&to=${customTo}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function applyCustom(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
  }

  const allDispositions = (data?.byDisposition ?? []).map(d => d.disposition);

  return (
    <div style={{ position: 'relative' }}>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>Analytics</h1>

        <div style={{ position: 'relative' }}>
          {/* Time range buttons */}
          <div style={{
            display: 'inline-flex', border: '1px solid var(--qa-border)', borderRadius: 8,
            overflow: 'hidden', background: 'var(--qa-card)',
          }}>
            {(['7', '30'] as Period[]).map(p => (
              <button key={p} onClick={() => { setPeriod(p); setShowPicker(false); }} style={{
                height: 32, padding: '0 14px', background: period === p ? 'var(--qa-text)' : 'transparent',
                border: 0, borderRight: '1px solid var(--qa-border)',
                fontSize: 13, color: period === p ? '#fff' : 'var(--qa-text-2)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {p} days
              </button>
            ))}
            <button onClick={() => setShowPicker(v => !v)} style={{
              height: 32, padding: '0 14px', background: period === 'custom' ? 'var(--qa-text)' : 'transparent',
              border: 0, fontSize: 13,
              color: period === 'custom' ? '#fff' : 'var(--qa-text-2)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Custom range
            </button>
          </div>

          {showPicker && (
            <DateRangePicker
              onApply={applyCustom}
              onCancel={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', borderRadius: 8, color: '#b91c1c', marginBottom: 24, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 32 }}>
        <PendingReviewCard
          data={loading ? null : (data?.pending ?? null)}
          loading={loading}
        />
        <IQSRingCard
          data={loading ? null : (data?.iqs ?? null)}
          loading={loading}
        />
      </div>

      {/* ── By Disposition ──────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>By Disposition</h2>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>
            {periodLabel} · click a row to expand sub-dispositions
          </span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <DispositionTreeTable
            mode="csat"
            rows={data?.byDisposition ?? []}
            loading={loading}
            periodLabel={periodLabel}
          />
        </div>

        <DispositionTreeTable
          mode="iqs"
          rows={data?.byDisposition ?? []}
          loading={loading}
          periodLabel={periodLabel}
        />
      </section>

      {/* ── Week-on-Week Trends ──────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <WoWTrendChart dispositions={allDispositions} />
      </section>

      <p style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic', marginTop: 0 }}>
        Data from live DB · disposition-scoped to your assignments
      </p>
    </div>
  );
}
