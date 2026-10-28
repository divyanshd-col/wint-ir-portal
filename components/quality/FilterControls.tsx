'use client';
import React, { useState } from 'react';
import DateRangePicker from './DateRangePicker';
import type { PeriodState } from './PeriodFilter';

const fmtShort = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Date range ▾" chip + calendar popover; the same control in every queue's filter bar. Empty strings mean no range. */
export function DateRangeChip({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const active = Boolean(from && to);
  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button type="button" className={`qf-chip${active ? ' on' : ''}`} onClick={() => setOpen(v => !v)}>
        {active ? `${fmtShort(from)} – ${fmtShort(to)}` : 'Date range'}
        <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <DateRangePicker
          onApply={(f, t) => { onChange(f, t); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** "Reset Filters" chip; disabled until something is filtered. */
export function ResetFilters({ active, onReset }: { active: boolean; onReset: () => void }) {
  return (
    <button type="button" className="qf-chip" disabled={!active} onClick={onReset}>
      Reset Filters
    </button>
  );
}

/** Same "Date range" chip for the e-mail queues, backed by their PeriodState (All / 7 / 30 / custom). */
export function PeriodRangeChip({ value, onChange }: { value: PeriodState; onChange: (v: PeriodState) => void }) {
  const [open, setOpen] = useState(false);
  const label =
    value.period === 'custom' && value.customFrom && value.customTo ? `${fmtShort(value.customFrom)} – ${fmtShort(value.customTo)}`
    : value.period === '7' ? 'Last 7 days'
    : value.period === '30' ? 'Last 30 days'
    : 'Date range';
  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button type="button" className={`qf-chip${value.period !== 'all' ? ' on' : ''}`} onClick={() => setOpen(v => !v)}>
        {label}
        <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <DateRangePicker
          onApply={(f, t) => { onChange({ period: 'custom', customFrom: f, customTo: t }); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}
