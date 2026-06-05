'use client';
import { useState, useEffect, useRef } from 'react';

interface Props {
  onApply:  (from: string, to: string) => void;
  onCancel: () => void;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW    = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function fmt(d: Date)      { return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtISO(d: Date)   { return d.toISOString().slice(0, 10); }
function sameDay(a: Date | null, b: Date | null) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function MonthCalendar({
  monthDate, start, end,
  onPick,
}: {
  monthDate: Date;
  start: Date | null;
  end:   Date | null;
  onPick: (d: Date) => void;
}) {
  const y = monthDate.getFullYear(), m = monthDate.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const days     = new Date(y, m + 1, 0).getDate();
  const today    = new Date();

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
        const date      = new Date(y, m, d);
        const isStart   = sameDay(date, start);
        const isEnd     = sameDay(date, end);
        const inRange   = start && end && date > start && date < end;
        const isToday   = sameDay(date, today);

        let bg = 'transparent', color = 'var(--qa-text)', borderRadius = 6;
        if (isStart || isEnd) { bg = 'var(--qa-text)'; color = '#fff'; }
        else if (inRange)      { bg = 'var(--qa-fill-light)'; borderRadius = 0; }

        return (
          <button key={d} onClick={() => onPick(date)} style={{
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

export default function DateRangePicker({ onApply, onCancel }: Props) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const [start, setStart] = useState<Date | null>(null);
  const [end,   setEnd]   = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const leftMonth  = viewMonth;
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

  const canApply = start != null && end != null;

  const selectedLabel = start && end
    ? `${fmt(start)}  –  ${fmt(end)}`
    : start ? `${fmt(start)}  –  …` : 'Select a start date';

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
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
      position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 40,
      width: 560, background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
      borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.12)', padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} style={{
          width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
          background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>‹</button>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around', fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
          <span>{MONTHS[leftMonth.getMonth()]} {leftMonth.getFullYear()}</span>
          <span>{MONTHS[rightMonth.getMonth()]} {rightMonth.getFullYear()}</span>
        </div>

        <button onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} style={{
          width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
          background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>›</button>
      </div>

      {/* Calendars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <MonthCalendar monthDate={leftMonth}  start={start} end={end} onPick={pick} />
        <MonthCalendar monthDate={rightMonth} start={start} end={end} onPick={pick} />
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--qa-border-sub)',
      }}>
        <span style={{ fontSize: 13, color: 'var(--qa-text-2)', fontFamily: 'ui-monospace, monospace' }}>
          {selectedLabel}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{
            height: 32, padding: '0 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
            background: 'var(--qa-card)', border: '1px solid var(--qa-border)', color: 'var(--qa-text)', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleApply} disabled={!canApply} style={{
            height: 32, padding: '0 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
            background: canApply ? 'var(--qa-text)' : 'var(--qa-fill-med)',
            border: canApply ? '1px solid var(--qa-text)' : '1px solid var(--qa-fill-med)',
            color: canApply ? '#fff' : 'var(--qa-text-3)',
            cursor: canApply ? 'pointer' : 'not-allowed',
          }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
