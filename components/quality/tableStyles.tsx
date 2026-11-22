import type React from 'react';

/** One type scale for every evaluation table (Chat / Call / Email; Pending, Disputes, Reviewed, Unscored).
 *  Taken from the Email Evaluation table. Cell content follows the same scale:
 *  names 14/500 · text 14 · dates 13 (time 11 mono) · numbers 13 mono (IQS 600) · IDs & mobiles 12 mono · status 13 · actions 12/500. */
export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const th: React.CSSProperties = {
  height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)',
  fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap',
};
export const thBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--qa-text-2)', fontWeight: 500, fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 4,
};
export const td: React.CSSProperties = {
  height: 52, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)',
  fontSize: 14, color: 'var(--qa-text)', verticalAlign: 'middle',
};
export const tdMono: React.CSSProperties = { ...td, fontFamily: MONO, fontSize: 12, color: 'var(--qa-text-2)' };
export const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: MONO, fontSize: 13 };
export const tdAct: React.CSSProperties = { ...td, textAlign: 'right' };

/** Inline pieces that repeat inside cells. */
export const iqsText: React.CSSProperties = { fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' };
export const actionText: React.CSSProperties = { fontSize: 12, fontWeight: 500 };

/** Date on one line (13px), time under it (11px mono) — the Email table's date cell. */
export function DateTime({ value }: { value?: string | null }) {
  if (!value) return <>—</>;
  const d = new Date(value);
  if (isNaN(d.getTime())) return <>{value}</>;
  return (
    <>
      <div style={{ fontSize: 13 }}>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      <div style={{ fontSize: 11, color: 'var(--qa-text-3)', marginTop: 2, fontFamily: MONO }}>
        {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>
    </>
  );
}

/** Checkbox for multi-select filter menus. Display only: the menu row handles the click, so the box ignores pointer events. */
export function Check({ checked }: { checked: boolean }) {
  return (
    <input
      type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden
      style={{ width: 14, height: 14, margin: 0, flexShrink: 0, accentColor: 'var(--accent)', pointerEvents: 'none' }}
    />
  );
}
