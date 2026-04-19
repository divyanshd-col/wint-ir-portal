'use client';

interface MetricCardProps {
  label: string;
  value: number | null;
  benchmark: number | null;
  wowDelta: number | null;
  format: 'score' | 'csat' | 'count';
  onClick?: () => void;
}

function formatValue(value: number | null, format: 'score' | 'csat' | 'count'): string {
  if (value === null) return '—';
  if (format === 'score') return `${value.toFixed(1)}%`;
  if (format === 'csat') return `${value.toFixed(2)}/5`;
  return Math.round(value).toString();
}

function formatBenchmark(value: number | null, format: 'score' | 'csat' | 'count'): string {
  if (value === null) return '—';
  if (format === 'score') return `${value.toFixed(1)}%`;
  if (format === 'csat') return `${value.toFixed(2)}/5`;
  return value.toFixed(1);
}

export default function MetricCard({ label, value, benchmark, wowDelta, format, onClick }: MetricCardProps) {
  const hasDelta = wowDelta !== null && wowDelta !== 0;
  const isUp = wowDelta !== null && wowDelta > 0;
  const isDown = wowDelta !== null && wowDelta < 0;

  const deltaDisplay = hasDelta
    ? `${isUp ? '+' : ''}${format === 'score' ? wowDelta!.toFixed(1) + '%' : format === 'csat' ? wowDelta!.toFixed(2) : Math.round(wowDelta!).toString()}`
    : wowDelta === 0 ? '0' : null;

  return (
    <div
      onClick={onClick}
      className={`bg-[#1e1e1e] border border-white/10 rounded-xl p-4 flex flex-col gap-2 ${onClick ? 'cursor-pointer hover:border-white/25 transition' : ''}`}
    >
      <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{label}</p>

      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold text-white tabular-nums">
          {formatValue(value, format)}
        </span>
        {deltaDisplay !== null && (
          <span className={`flex items-center gap-0.5 text-sm font-medium ${isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-gray-500'}`}>
            {isUp && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 2l4 5H2l4-5z"/>
              </svg>
            )}
            {isDown && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 10L2 5h8l-4 5z"/>
              </svg>
            )}
            {deltaDisplay}
          </span>
        )}
      </div>

      {benchmark !== null && (
        <div className="mt-1">
          <div className="h-px bg-white/10 w-full relative">
            <span className="absolute -top-2.5 right-0 text-[10px] text-gray-600">
              CX avg: {formatBenchmark(benchmark, format)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
