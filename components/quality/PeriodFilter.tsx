'use client';

import { useState } from 'react';
import DateRangePicker from './DateRangePicker';
import type { Period } from '@/lib/email/ui';

export interface PeriodState {
  period: Period;
  customFrom?: string;
  customTo?: string;
}

export const DEFAULT_PERIOD: PeriodState = { period: 'all' };

/** All / 7 days / 30 days / Custom range control, the same look as the Quality Analytics header. */
export default function PeriodFilter({
  value,
  onChange,
  showAll = true,
}: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
  showAll?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const on = (active: boolean) => ({
    background: active ? 'var(--qa-text)' : 'transparent',
    color: active ? 'var(--qa-on-text, #fff)' : 'var(--qa-text-2)',
  });
  const base = { height: 32, padding: '0 14px', border: 0, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as const;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'inline-flex', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--qa-card)' }}>
        {showAll && (
          <button
            onClick={() => { onChange({ period: 'all' }); setShowPicker(false); }}
            style={{ ...base, ...on(value.period === 'all'), borderRight: '1px solid var(--qa-border)' }}
          >
            All
          </button>
        )}
        {(['7', '30'] as const).map((p) => (
          <button
            key={p}
            onClick={() => { onChange({ period: p }); setShowPicker(false); }}
            style={{ ...base, ...on(value.period === p), borderRight: '1px solid var(--qa-border)' }}
          >
            {p} days
          </button>
        ))}
        <button onClick={() => setShowPicker((v) => !v)} style={{ ...base, ...on(value.period === 'custom') }}>
          {value.period === 'custom' && value.customFrom && value.customTo ? `${value.customFrom} – ${value.customTo}` : 'Custom range'}
        </button>
      </div>
      {showPicker && (
        <DateRangePicker
          onApply={(from, to) => { onChange({ period: 'custom', customFrom: from, customTo: to }); setShowPicker(false); }}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
