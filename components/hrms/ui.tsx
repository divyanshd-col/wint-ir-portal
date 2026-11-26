'use client';

/**
 * The prototype's component primitives (ui.jsx and the helpers in data.jsx), ported one to one. Markup and class names are the
 * prototype's, so the stylesheet (hrms.css) styles them as designed. Used by every HRMS screen.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export const IC: Record<string, string[]> = {
  home: ['M3 11l9-8 9 8', 'M5 9.5V20h14V9.5'], list: ['M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'], bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 21h4'],
  ledger: ['M5 3h14v18H5z', 'M9 8h6M9 12h6M9 16h3'], check: ['M5 12l5 5L20 7'], calendar: ['M4 6h16v14H4z', 'M4 10h16M8 3v4M16 3v4'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6', 'M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2.2.6 3.5 2.6 3.5 5'],
  grid: ['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'], userplus: ['M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M3 21c0-4 3-6.5 7-6.5S17 17 17 21', 'M19 8v6M16 11h6'],
  scale: ['M12 3v18M7 21h10M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z'], sliders: ['M4 7h10M18 7h2M4 17h2M10 17h10', 'M16 5v4M8 15v4'],
  lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'], shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  refresh: ['M20 11a8 8 0 0 0-14-4M4 5v4h4', 'M4 13a8 8 0 0 0 14 4M20 19v-4h-4'], search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'], plus: ['M12 5v14M5 12h14'], x: ['M6 6l12 12M18 6L6 18'], clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  alert: ['M12 4l9 16H3z', 'M12 10v4M12 17h.01'], info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5M12 8h.01'], layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  map: ['M4 5h16v14H4z', 'M4 10h16M9 10v9'], up: ['M12 19V5M6 11l6-6 6 6'], user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  payroll: ['M3 6h18v12H3z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], logout: ['M10 4H5v16h5', 'M15 8l4 4-4 4M19 12H9'], chev: ['M9 6l6 6-6 6'], inbox: ['M3 13l3-8h12l3 8v6H3z', 'M3 13h5l1 3h6l1-3h5'],
};
export const Ico = ({ n, size = 18, sw = 1.6 }: { n: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
    {(IC[n] ?? []).map((d, i) => <path key={i} d={d} />)}
  </svg>
);

// ---- formatting helpers from data.jsx (all times in IST) ----
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Quarter days, always two decimals, a real minus sign: 3.25, 0.50, −2.00 */
export const q = (n: number) => { const v = Math.round(n * 4) / 4; return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2); };
export const ms = (s: number) => [Math.floor(s / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':');
export const hms = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':');
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?';
/** 'Mon, 23 Nov 2026' from a YYYY-MM-DD date */
export const fd = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

export const STATUSES: [string, string][] = [
  ['Applied', 'st-applied'], ['In process', 'st-inproc'], ['Pending for approval', 'st-pending'], ['Approved', 'st-approved'], ['Auto-approved', 'st-auto-ok'], ['Rejected', 'st-rejected'],
  ['Auto-rejected', 'st-auto-no'], ['Auto-cancelled', 'st-auto-can'], ['Cancelled', 'st-cancelled'], ['Cancelled (exit)', 'st-exit'], ['Taken', 'st-taken'],
];

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'tertiary'; size?: 'sm' | 'lg' };
export const Button = ({ kind = 'primary', size, children, className, type = 'button', ...p }: BtnProps) => <button type={type} {...p} className={cx('btn', 'btn-' + kind, size, className)}>{children}</button>;
export const Field = ({ label, req, help, children }: { label?: string; req?: boolean; help?: React.ReactNode; children: React.ReactNode }) => (
  <div className="field">{label && <label>{label}{req && <span className="req">*</span>}</label>}{children}{help && <div className="help">{help}</div>}</div>
);
export const Avatar = ({ name, sm }: { name: string; sm?: boolean }) => <span className={cx('avatar', sm && 'sm')}>{initials(name)}</span>;
export const Chip = ({ children, kind }: { children: React.ReactNode; kind?: 'yes' | 'no' | 'part' }) => <span className={cx('chip', kind)}>{children}</span>;
export const StatusBadge = ({ status }: { status: string }) => { const s = STATUSES.find(x => x[0] === status); return <span className={cx('badge', s ? s[1] : 'st-applied')}><i />{status}</span>; };
export const LopTag = () => <span className="tag tag-lop">LOP</span>;
export const MovedUpTag = () => <span className="tag tag-moved"><Ico n="up" size={12} sw={2} />Moved up</span>;

export const QDays = ({ v, size = 14, weight, unit }: { v: number; size?: number; weight?: number; unit?: string }) => (
  <span className={cx('qd', v < 0 && 'neg')} style={{ fontSize: size, fontWeight: weight }}>{q(v)}{unit && <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: Math.max(12, size * 0.4), color: 'var(--muted)', marginLeft: 6 }}>{unit}</span>}</span>
);
export const BalanceCard = ({ label, children, note, neg, sub }: { label: string; children: React.ReactNode; note?: React.ReactNode; neg?: boolean; sub?: React.ReactNode }) => (
  <div className={cx('card', 'bal', neg && 'neg')}><div className="ov">{label}</div>{children}{note && <div className="n">{note}</div>}{sub}</div>
);

export const useTick = (on = true) => { const [, s] = useState(0); useEffect(() => { if (!on) return; const i = setInterval(() => s(x => x + 1), 1000); return () => clearInterval(i); }, [on]); };
/** The current time, refreshed every second (reading the clock in render is not allowed, so it lives in state). */
export const useNow = (on = true) => { const [now, set] = useState(() => Date.now()); useEffect(() => { if (!on) return; const i = setInterval(() => set(Date.now()), 1000); return () => clearInterval(i); }, [on]); return now; };

/** The 5-minute In process timer, counting to a real end time. */
export const CountdownFiveMin = ({ endsAt }: { endsAt: string }) => {
  const now = useNow();
  const left = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000)); const done = left === 0;
  return (
    <div className="cd"><div className="row" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 8 }}><Ico n="clock" size={16} /><span className="b14" style={{ fontWeight: 600 }}>In process</span></span><span className="sm12 mut">IST</span></div>
      <div className="t">{done ? 'Checking now' : ms(left)}</div><div className="bar"><div style={{ width: (Math.min(300, left) / 300 * 100) + '%' }} /></div>
      <div className="sm12 mut">{done ? 'The system is checking your balance, notice and daily limit.' : 'You can still edit or cancel. Editing restarts the 5 minutes.'}</div></div>
  );
};
/** The 11:59 pm IST deadline timer on an auto-rejected request. */
export const CountdownDeadline = ({ deadline, label = 'Decide by 11:59 pm IST today' }: { deadline: string; label?: string }) => {
  const now = useNow();
  const s = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  return (
    <div className="cd dl"><div className="row" style={{ gap: 8 }}><Ico n="clock" size={16} /><span className="b14" style={{ fontWeight: 600 }}>{label}</span></div><div className="t">{hms(s)}</div><div className="bar"><div style={{ width: Math.min(100, s / 864) + '%' }} /></div>
      <div className="sm12 mut">If you don&apos;t choose, it&apos;s cancelled automatically and your days come back.</div></div>
  );
};
export const CopyId = ({ id }: { id: string }) => {
  const [ok, set] = useState(false);
  return <button type="button" className="copyid" title="Copy leave ID" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(id).catch(() => {}); set(true); setTimeout(() => set(false), 1200); }}>{id}<Ico n={ok ? 'check' : 'copy'} size={13} /></button>;
};

export const Banner = ({ kind = 'info', children, action, onAction }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode; action?: string; onAction?: () => void }) => (
  <div className={cx('banner', 'bn-' + kind)} role={kind === 'error' ? 'alert' : 'status'}><Ico n={kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert'} size={18} /><div className="x">{children}</div>{action && <Button kind="secondary" size="sm" onClick={onAction}>{action}</Button>}</div>
);
export const WarningDialog = ({ title = 'Before you continue', children, ok = 'Okay', onOk, onCancel, busy }: { title?: string; children: React.ReactNode; ok?: string; onOk: () => void; onCancel?: () => void; busy?: boolean }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && onCancel) onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onCancel]);
  return (
    <div className="scrim" role="dialog" aria-modal="true"><div className="dlg"><div className="row" style={{ gap: 10, marginBottom: 12, color: 'var(--yellow-500)' }}><Ico n="alert" size={20} /><span className="h2s" style={{ color: '#fff' }}>{title}</span></div>
      <div className="b14" style={{ color: '#e5e5e5', marginBottom: 24 }}>{children}</div><div className="row" style={{ justifyContent: 'flex-end' }}>{onCancel && <Button kind="secondary" onClick={onCancel}>Go back</Button>}<Button onClick={onOk} disabled={busy}>{ok}</Button></div></div></div>
  );
};

export interface Col<R> { key: string; label: React.ReactNode; w?: number; r?: boolean; sortable?: boolean; sort?: (r: R) => string | number; render?: (r: R) => React.ReactNode }
export function DataTable<R extends Record<string, unknown>>({ columns, rows, foot, onRow }: { columns: Col<R>[]; rows: R[]; foot?: React.ReactNode; onRow?: (r: R) => void }) {
  const [sk, setSk] = useState<string | null>(null); const [dir, setDir] = useState(1);
  const sorted = useMemo(() => {
    if (!sk) return rows; const c = columns.find(x => x.key === sk)!; const val = c.sort ?? ((r: R) => r[c.key] as string | number);
    return [...rows].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  }, [sk, dir, rows, columns]);
  return (
    <div className="card flush"><table className="tbl"><thead><tr>{columns.map(c => <th key={c.key} className={cx(c.r && 'r', c.sortable && 'sortable')} style={{ width: c.w }} onClick={c.sortable ? () => { if (sk === c.key) setDir(-dir); else { setSk(c.key); setDir(1); } } : undefined} aria-sort={sk === c.key ? (dir > 0 ? 'ascending' : 'descending') : undefined}>{c.label}{sk === c.key && (dir > 0 ? ' ↑' : ' ↓')}</th>)}</tr></thead>
      <tbody>{sorted.map((r, i) => <tr key={i} onClick={onRow && (() => onRow(r))} style={onRow ? { cursor: 'pointer' } : undefined}>{columns.map(c => <td key={c.key} className={c.r ? 'r' : ''}>{c.render ? c.render(r) : (r[c.key] as React.ReactNode)}</td>)}</tr>)}</tbody></table>{foot && <div className="tfoot">{foot}</div>}</div>
  );
}

export interface TlItem { t: string; at: string; who?: string | null; reason?: string | null; k?: 'ok' | 'no' | 'up' | 'warn'; now?: boolean; badge?: React.ReactNode }
export const Timeline = ({ items }: { items: TlItem[] }) => (
  <div className="tl">{items.map((x, i) => <div key={i} className={cx('tli', x.k, x.now && 'now')}><div className="dot"><i /></div><div><div className="row" style={{ gap: 8 }}><span className="tt">{x.t}</span>{x.badge}</div><div className="tm">{x.at}{x.who && ' · ' + x.who}</div>{x.reason && <div className="rs">{x.reason}</div>}</div></div>)}</div>
);

export const EmptyState = ({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) => (
  <div className="state"><div className="ic"><Ico n="inbox" size={22} /></div><div className="h2s">{title}</div><div className="b14 mut" style={{ maxWidth: 360 }}>{body}</div>{action && <Button kind="secondary" size="sm" onClick={onAction}>{action}</Button>}</div>
);
export const LoadingState = ({ rows = 4 }: { rows?: number }) => (
  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="row" style={{ gap: 16, flexWrap: 'nowrap' }}><div className="sk" style={{ width: 96, height: 16 }} /><div className="sk" style={{ flex: 1, height: 16 }} /><div className="sk" style={{ width: 80, height: 20 }} /></div>)}</div>
);
export const ErrorState = ({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) => (
  <div className="state err"><div className="ic"><Ico n="alert" size={22} /></div><div className="h2s">{title}</div><div className="b14 mut" style={{ maxWidth: 360 }}>{body}</div>{onRetry && <Button kind="secondary" size="sm" onClick={onRetry}>Try again</Button>}</div>
);
export const PageHeader = ({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) => <div className="ph"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>{right}</div>;
export const Toggle = ({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) => <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cx('tgl', on && 'on')} onClick={() => onChange(!on)}><i /></button>;
export const Tabs = ({ tabs, value, onChange }: { tabs: { k: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) => (
  <div className="tabs" role="tablist">{tabs.map(t => <button key={t.k} type="button" role="tab" aria-selected={t.k === value} className={t.k === value ? 'on' : ''} onClick={() => onChange(t.k)}>{t.label}{t.count != null && t.count > 0 && <span className="tcount">{t.count}</span>}</button>)}</div>
);
export const Dialog = ({ title, children, onClose, width }: { title: string; children: React.ReactNode; onClose: () => void; width?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="scrim" role="dialog" aria-modal="true" aria-label={title}><div className="dlg" ref={ref} style={width ? { width } : undefined}><div className="row" style={{ justifyContent: 'space-between', marginBottom: 16, flexWrap: 'nowrap' }}><span className="h2s">{title}</span><button type="button" className="iconbtn" aria-label="Close" onClick={onClose}><Ico n="x" size={18} /></button></div>{children}</div></div>;
};

/** Legend row under the calendar toolbar: [cell class, label] pairs. */
export const Legend = ({ items }: { items: [string, string][] }) => <div className="legend">{items.map(([k, l]) => <span key={k}><i className={k} />{l}</span>)}</div>;

/** One calendar day split into first and second half (the prototype's DayCell). `date` is YYYY-MM-DD. */
export type HalfState = { k: string; t?: string };
const HalfRow = ({ lbl, s, small }: { lbl: string; s: HalfState; small?: boolean }) => <div className={cx('h', 'k-' + s.k)} title={lbl + ': ' + (s.t || s.k)}>{!small && <em>{lbl}</em>}<b>{s.t || ''}</b></div>;
export const DayCell = ({ date, today, out, sel, first, second, small }: { date: string; today?: boolean; out?: boolean; sel?: boolean; first: HalfState; second: HalfState; small?: boolean }) => {
  const d = new Date(date + 'T00:00:00Z');
  return <div className={cx('dc', small && 'sm', today && 'today', out && 'out', sel && 'sel')}><div className="dn"><span className="d">{d.getUTCDate()}</span><small>{WD[d.getUTCDay()]}</small></div><HalfRow lbl="First half" s={first} small={small} /><HalfRow lbl="Second half" s={second} small={small} /></div>;
};
