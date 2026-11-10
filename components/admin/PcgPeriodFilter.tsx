'use client';

export type PcgPeriod = '7d' | '30d' | 'custom';

/** The period filter on the PCG Call Quality and TL Call Quality pages (it used to be a read-only "Period:" label with the real
 *  control up in the top bar). Same chip look as before; the value is a dropdown, and Custom adds two date inputs. */
export default function PcgPeriodFilter({ range, start, end, onChange }: {
  range: PcgPeriod; start: string; end: string; onChange: (range: PcgPeriod, start: string, end: string) => void;
}) {
  const dateCls = 'text-xs tabular-nums font-medium bg-zinc-50 border border-[#E4E4E7] rounded px-2 py-1 text-[#111111] outline-none cursor-pointer';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 bg-white border border-[#E4E4E7] px-2.5 py-1 rounded-lg shadow-2xs">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <label htmlFor="pcg-period" className="text-zinc-500 font-normal">Period:</label>
        <select id="pcg-period" value={range} onChange={e => onChange(e.target.value as PcgPeriod, start, end)}
          className="font-semibold text-zinc-900 bg-transparent outline-none cursor-pointer">
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="custom">Custom Range</option>
        </select>
      </div>
      {range === 'custom' && (
        <div className="flex items-center gap-1.5 bg-white border border-[#E4E4E7] px-2 py-1 rounded-lg shadow-2xs">
          <input type="date" aria-label="From" value={start} onChange={e => onChange('custom', e.target.value, end)} className={dateCls} />
          <span className="text-xs text-[#71717A] font-medium">to</span>
          <input type="date" aria-label="To" value={end} onChange={e => onChange('custom', start, e.target.value)} className={dateCls} />
        </div>
      )}
    </div>
  );
}
