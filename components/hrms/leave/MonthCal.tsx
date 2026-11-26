'use client';

import { DayCell, Ico, WD, type HalfState } from '../ui';
import { addMonths, monthName } from './format';

export interface CalCell { first: HalfState; second: HalfState; disabled?: boolean; sel?: boolean; title?: string }

/** The prototype's month calendar: weekday header, day cells split into two halves, previous and next month. `month` is YYYY-MM. */
export default function MonthCal({ month, setMonth, today, cell, onPick, min, max }: { month: string; setMonth: (m: string) => void; today: string; cell: (day: string) => CalCell; onPick: (day: string) => void; min: string; max: string }) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(first + 'T00:00:00Z').getUTCDay();
  return (
    <div className="mcal">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="h2s">{monthName(month)}</span>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="iconbtn" aria-label="Previous month" disabled={month <= min} onClick={() => setMonth(addMonths(month, -1))}><span style={{ transform: 'rotate(180deg)', display: 'grid' }}><Ico n="chev" /></span></button>
          <button type="button" className="iconbtn" aria-label="Next month" disabled={month >= max} onClick={() => setMonth(addMonths(month, 1))}><Ico n="chev" /></button>
        </div>
      </div>
      <div className="calg">
        {WD.map(w => <div key={w} className="calw">{w}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={'b' + i} />)}
        {Array.from({ length: n }).map((_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, '0')}`;
          const c = cell(day);
          return <button key={day} type="button" className="calbtn" disabled={c.disabled} title={c.title} onClick={() => onPick(day)} aria-label={day}><DayCell small date={day} today={day === today} out={c.disabled} sel={c.sel} first={c.first} second={c.second} /></button>;
        })}
      </div>
    </div>
  );
}
