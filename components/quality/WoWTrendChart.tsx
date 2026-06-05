'use client';
import { useState, useEffect } from 'react';

interface WeekData {
  weekStart:          string;
  weekLabel:          string;
  iqsPct:             number | null;
  automationPct:      number | null;
  avgResolutionSecs:  number | null;
  avgResolutionLabel: string | null;
}

interface Props {
  dispositions: string[];
}

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
  </svg>
);

function clamp(n: number, lo = 8, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function barHeightIQS(v: number)  { return clamp((v - 60) / 35 * 100); }
function barHeightAuto(v: number) { return clamp(v * 1.4); }
function barHeightTime(secs: number) { return clamp(35 + (secs - 180) * (50 / 300)); }

function downloadCSV(weeks: WeekData[], disposition: string) {
  const lines = [['Week','IQS Avg','Automation %','Avg Resolution Time'].join(',')];
  for (const w of weeks) {
    lines.push([
      `"${w.weekLabel}"`,
      w.iqsPct ?? '—',
      w.automationPct != null ? `${w.automationPct}%` : '—',
      w.avgResolutionLabel ?? '—',
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `qa-wow-trend-${disposition}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function WoWTrendChart({ dispositions }: Props) {
  const [selectedDispo, setSelectedDispo] = useState('all');
  const [weeks,   setWeeks]   = useState<WeekData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const url = `/api/cx/qa/wow-trend?disposition=${encodeURIComponent(selectedDispo)}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setWeeks(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedDispo]);

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: 24 }}>
        {/* Chart header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>Week-on-Week Trends</h3>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Disposition selector */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                Disposition
              </span>
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <select
                  value={selectedDispo}
                  onChange={e => setSelectedDispo(e.target.value)}
                  style={{
                    appearance: 'none', height: 32, padding: '0 30px 0 12px',
                    background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
                    fontFamily: 'inherit', fontSize: 13, color: 'var(--qa-text)', cursor: 'pointer',
                    minWidth: 168,
                  }}
                >
                  <option value="all">All Dispositions</option>
                  {dispositions.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <span style={{ position: 'absolute', right: 11, fontSize: 10, color: 'var(--qa-text-2)', pointerEvents: 'none' }}>▾</span>
              </div>
            </label>

            <button
              onClick={() => downloadCSV(weeks, selectedDispo)}
              disabled={loading || !weeks.length}
              title="Export as CSV"
              style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <DownloadIcon />
            </button>
          </div>
        </div>

        {/* Bar chart */}
        <div style={{
          height: 240, position: 'relative', padding: '28px 12px 36px',
          border: '1px dashed var(--qa-border)', borderRadius: 6, marginTop: 12,
          background: `
            linear-gradient(to right, transparent 0, transparent calc(100% - 1px), var(--qa-border-sub) calc(100% - 1px)),
            linear-gradient(to bottom, var(--qa-border-sub) 1px, transparent 1px)
          `,
          backgroundSize: '20% 100%, 100% 25%',
        }}>
          {loading ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--qa-text-3)', fontSize: 13 }}>
              Loading…
            </div>
          ) : weeks.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--qa-text-3)', fontSize: 13 }}>
              No data for this period
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: '100%', gap: 8 }}>
              {weeks.map(w => (
                <div key={w.weekStart} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1, height: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: '100%', width: '100%', justifyContent: 'center', paddingTop: 18 }}>
                    {/* IQS bar */}
                    {w.iqsPct != null && (
                      <div style={{ width: 22, height: `${barHeightIQS(w.iqsPct)}%`, position: 'relative', borderRadius: '2px 2px 0 0', background: 'var(--qa-gray-700)', flexShrink: 0 }}>
                        <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--qa-text-2)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                          {w.iqsPct}
                        </span>
                      </div>
                    )}
                    {/* Automation bar */}
                    {w.automationPct != null && (
                      <div style={{
                        width: 22, height: `${barHeightAuto(w.automationPct)}%`, position: 'relative',
                        borderRadius: '2px 2px 0 0', flexShrink: 0,
                        background: 'var(--qa-fill-med)',
                        backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.06) 4px 8px)',
                      }}>
                        <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--qa-text-2)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                          {w.automationPct}%
                        </span>
                      </div>
                    )}
                    {/* Resolution time bar */}
                    {w.avgResolutionSecs != null && (
                      <div style={{
                        width: 22, height: `${barHeightTime(w.avgResolutionSecs)}%`, position: 'relative',
                        borderRadius: '2px 2px 0 0', flexShrink: 0,
                        background: 'var(--qa-text-3)',
                        backgroundImage: 'repeating-linear-gradient(-45deg, transparent 0 4px, rgba(255,255,255,0.25) 4px 8px)',
                      }}>
                        <span style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--qa-text-2)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                          {w.avgResolutionLabel}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--qa-text-2)', textAlign: 'center' }}>
                    {w.weekLabel}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, padding: '16px 24px 24px', fontSize: 12, color: 'var(--qa-text-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 14, height: 10, borderRadius: 2, background: 'var(--qa-gray-700)', display: 'inline-block' }} />
          IQS avg
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 14, height: 10, borderRadius: 2, display: 'inline-block',
            background: 'var(--qa-fill-med)',
            backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,0.08) 3px 6px)',
          }} />
          Automation %
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 14, height: 10, borderRadius: 2, display: 'inline-block',
            background: 'var(--qa-text-3)',
            backgroundImage: 'repeating-linear-gradient(-45deg, transparent 0 3px, rgba(255,255,255,0.25) 3px 6px)',
          }} />
          Avg Resolution Time
        </div>
      </div>
    </div>
  );
}
