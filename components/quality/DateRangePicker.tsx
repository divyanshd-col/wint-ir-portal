'use client';
import { useState, useEffect, useRef } from 'react';
import { uiZoom } from '@/lib/ui-zoom';

interface Props {
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
  align?: 'left' | 'right' | 'auto';
  initialFrom?: string;
  initialTo?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function fmt(d: Date) { return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
// Use local date components so IST dates don't shift to the previous day via UTC conversion
function fmtISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function parseISO(s?: string | null): Date | null {
  if (!s) return null;
  const raw = s.split('T')[0];
  const parts = raw.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function sameDay(a: Date | null, b: Date | null) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function MonthCalendar({
  monthDate, start, end,
  onPick,
}: {
  monthDate: Date;
  start: Date | null;
  end: Date | null;
  onPick: (d: Date) => void;
}) {
  const y = monthDate.getFullYear(), m = monthDate.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = new Date();

  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
      {DOW.map(d => (
        <div key={d} style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em',
          color: 'var(--qa-text-3)', textAlign: 'center', height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{d}</div>
      ))}
      {cells.map((d, i) => {
        if (d == null) return <div key={`e${i}`} />;
        const date = new Date(y, m, d);
        const isStart = sameDay(date, start);
        const isEnd = sameDay(date, end);
        const inRange = start && end && date > start && date < end;
        const isToday = sameDay(date, today);

        let bg = 'transparent', color = 'var(--qa-text)', borderRadius: React.CSSProperties['borderRadius'] = 6;
        if (isStart && isEnd) {
          bg = 'var(--qa-text)'; color = 'var(--qa-on-text, #fff)'; borderRadius = 6;
        } else if (isStart) {
          bg = 'var(--qa-text)'; color = 'var(--qa-on-text, #fff)'; borderRadius = end ? '6px 0 0 6px' : 6;
        } else if (isEnd) {
          bg = 'var(--qa-text)'; color = 'var(--qa-on-text, #fff)'; borderRadius = '0 6px 6px 0';
        } else if (inRange) {
          bg = 'var(--qa-fill-light)'; borderRadius = 0;
        }

        return (
          <button key={d} type="button" onClick={() => onPick(date)} style={{
            height: 30, border: 0, background: bg, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12, color,
            borderRadius, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: isToday ? 700 : 400,
            textDecoration: isToday ? 'underline' : 'none',
            textUnderlineOffset: 3,
          }}>
            {d}
          </button>
        );
      })}
    </div>
  );
}

export default function DateRangePicker({ onApply, onCancel, align, initialFrom, initialTo }: Props) {
  const today = new Date();
  const initStart = parseISO(initialFrom);
  const initEnd = parseISO(initialTo);

  const [start, setStart] = useState<Date | null>(initStart);
  const [end, setEnd] = useState<Date | null>(initEnd);
  const ref = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState<number>(0);
  const [effectiveAlign, setEffectiveAlign] = useState<'left' | 'right'>('left');

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const focus = initEnd || initStart;
    if (focus) {
      return new Date(focus.getFullYear(), focus.getMonth() - 1, 1);
    }
    return new Date(today.getFullYear(), today.getMonth() - 1, 1);
  });

  const leftMonth = viewMonth;
  const rightMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);

  function pick(date: Date) {
    if (!start || (start && end)) {
      setStart(date); setEnd(null);
    } else if (date < start) {
      setEnd(start); setStart(date);
    } else {
      setEnd(date);
    }
  }

  function applyPreset(preset: 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth') {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let s: Date;
    let e: Date = t;

    if (preset === 'today') {
      s = t;
      e = t;
    } else if (preset === 'yesterday') {
      const y = new Date(t);
      y.setDate(y.getDate() - 1);
      s = y;
      e = y;
    } else if (preset === '7d') {
      const d = new Date(t);
      d.setDate(d.getDate() - 6);
      s = d;
      e = t;
    } else if (preset === '30d') {
      const d = new Date(t);
      d.setDate(d.getDate() - 29);
      s = d;
      e = t;
    } else { // 'thisMonth'
      s = new Date(t.getFullYear(), t.getMonth(), 1);
      e = t;
    }

    setStart(s);
    setEnd(e);
    setViewMonth(new Date(e.getFullYear(), e.getMonth() - 1, 1));
  }

  const isPresetActive = (preset: 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth') => {
    if (!start || !end) return false;
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (preset === 'today') return sameDay(start, t) && sameDay(end, t);
    if (preset === 'yesterday') {
      const y = new Date(t); y.setDate(y.getDate() - 1);
      return sameDay(start, y) && sameDay(end, y);
    }
    if (preset === '7d') {
      const d = new Date(t); d.setDate(d.getDate() - 6);
      return sameDay(start, d) && sameDay(end, t);
    }
    if (preset === '30d') {
      const d = new Date(t); d.setDate(d.getDate() - 29);
      return sameDay(start, d) && sameDay(end, t);
    }
    if (preset === 'thisMonth') {
      const m1 = new Date(t.getFullYear(), t.getMonth(), 1);
      return sameDay(start, m1) && sameDay(end, t);
    }
    return false;
  };

  const canApply = start != null && end != null;

  const selectedLabel = start && end
    ? (sameDay(start, end) ? fmt(start) : `${fmt(start)}  –  ${fmt(end)}`)
    : start ? `${fmt(start)}  –  …` : 'Select a date or range';

  // Smart alignment & clamp within viewport
  useEffect(() => {
    if (!ref.current) return;
    const parent = ref.current.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;

    let initAlign: 'left' | 'right' = 'left';
    if (align === 'right') {
      initAlign = 'right';
    } else if (align === 'left') {
      initAlign = 'left';
    } else if (parentRect) {
      initAlign = parentRect.left > window.innerWidth / 2 ? 'right' : 'left';
    }
    setEffectiveAlign(initAlign);
  }, [align]);

  useEffect(() => {
    const clamp = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const padding = 12;
      const vw = window.innerWidth;

      let shift = 0;
      if (rect.right > vw - padding) {
        shift = (vw - padding) - rect.right;
      }
      if (rect.left + shift < padding) {
        shift = padding - rect.left;
      }
      const cssShift = shift / uiZoom();   // measured on screen, applied in CSS pixels
      setShiftX(prev => (prev !== cssShift ? cssShift : prev));
    };

    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [effectiveAlign]);

  // Close on outside click (ignoring clicks on the trigger anchor itself)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (ref.current.parentElement && ref.current.parentElement.contains(e.target as Node)) {
        return;
      }
      onCancel();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  function handleApply() {
    if (!start || !end) return;
    onApply(fmtISO(start), fmtISO(end));
  }

  return (
    <div ref={ref} style={{
      position: 'absolute',
      top: 'calc(100% + 8px)',
      ...(effectiveAlign === 'left' ? { left: 0 } : { right: 0 }),
      transform: shiftX !== 0 ? `translateX(${shiftX}px)` : undefined,
      zIndex: 100,
      width: 560,
      maxWidth: 'calc(100vw - 24px)',
      boxSizing: 'border-box',
      background: 'var(--qa-card)',
      border: '1px solid var(--qa-border)',
      borderRadius: 10,
      boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
      padding: 16,
    }}>
      {/* Quick Presets Row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--qa-border-sub)' }}>
        {[
          { id: 'today', label: 'Today' },
          { id: 'yesterday', label: 'Yesterday' },
          { id: '7d', label: 'Last 7 days' },
          { id: '30d', label: 'Last 30 days' },
          { id: 'thisMonth', label: 'This month' },
        ].map(p => {
          const active = isPresetActive(p.id as any);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id as any)}
              style={{
                height: 26, padding: '0 10px', borderRadius: 6,
                border: `1px solid ${active ? 'var(--qa-text)' : 'var(--qa-border)'}`,
                background: active ? 'var(--qa-text)' : 'var(--qa-card)',
                color: active ? 'var(--qa-on-text, #fff)' : 'var(--qa-text-2)',
                fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} style={{
          width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
          background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>‹</button>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around', fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
          <span>{MONTHS[leftMonth.getMonth()]} {leftMonth.getFullYear()}</span>
          <span>{MONTHS[rightMonth.getMonth()]} {rightMonth.getFullYear()}</span>
        </div>

        <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} style={{
          width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
          background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>›</button>
      </div>

      {/* Calendars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 20 }}>
        <MonthCalendar monthDate={leftMonth} start={start} end={end} onPick={pick} />
        <MonthCalendar monthDate={rightMonth} start={start} end={end} onPick={pick} />
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--qa-border-sub)',
        gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-2)', fontFamily: 'ui-monospace, monospace' }}>
            {selectedLabel}
          </span>
          {(start || end) && (
            <button
              type="button"
              onClick={() => { setStart(null); setEnd(null); }}
              style={{
                background: 'none', border: 'none', color: 'var(--qa-text-3)', fontSize: 11,
                textDecoration: 'underline', cursor: 'pointer', padding: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onCancel} style={{
            height: 32, padding: '0 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
            background: 'var(--qa-card)', border: '1px solid var(--qa-border)', color: 'var(--qa-text)', cursor: 'pointer',
          }}>Cancel</button>
          <button type="button" onClick={handleApply} disabled={!canApply} style={{
            height: 32, padding: '0 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
            background: canApply ? 'var(--qa-text)' : 'var(--qa-fill-med)',
            border: canApply ? '1px solid var(--qa-text)' : '1px solid var(--qa-fill-med)',
            color: canApply ? 'var(--qa-on-text, #fff)' : 'var(--qa-text-3)',
            cursor: canApply ? 'pointer' : 'not-allowed',
          }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
