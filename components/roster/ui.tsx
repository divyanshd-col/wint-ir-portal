'use client';

import React from 'react';

export interface Pattern { id: number; label: string; off_weekdays: number[] }
export interface Person { userId: number; name: string; role: string; tlUserId: number | null; tlName: string | null; pattern: number | null; cells: ('work' | 'off' | 'extra' | 'none')[]; channels: string[]; canEdit: boolean }
export interface Scheduled { id: number; user_id: number; name: string; from_pattern: number | null; to_pattern: number; starts_on: string; reason: string; set_by: string | null; set_at: string; updated_at: string; canEdit: boolean }
export interface RosterData { today: string; view: 'day' | 'week' | 'month'; anchor: string; days: string[]; patterns: Pattern[]; people: Person[]; scheduled: Scheduled[]; viewer: { userId: number; role: string } }

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return { wd: WD[d.getUTCDay()], d: d.getUTCDate(), m: MON[d.getUTCMonth()], y: d.getUTCFullYear() }; };
export const fmtDay = (iso: string) => { const p = parts(iso); return `${p.wd}, ${p.d} ${p.m} ${p.y}`; };
export const fmtShort = (iso: string) => { const p = parts(iso); return `${p.d} ${p.m}`; };
export const fmtMonth = (iso: string) => { const p = parts(iso); return `${['January','February','March','April','May','June','July','August','September','October','November','December'][['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(p.m)]} ${p.y}`; };
export const dayNum = (iso: string) => parts(iso).d;
export const wdOf = (iso: string) => parts(iso).wd;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';

export const inputCls = 'border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30';
export const btnSecondary: React.CSSProperties = { border: '1px solid var(--qa-border)', background: 'var(--qa-card)', color: 'var(--qa-text)', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
export const btnPrimary: React.CSSProperties = { border: 0, background: 'var(--accent)', color: 'var(--accent-on)', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

export function Avatar({ name }: { name: string }) {
  return <span className="shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center">{initials(name)}</span>;
}

export function Modal({ title, width = 520, onClose, children }: { title: string; width?: number; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }}>
      <div style={{ width, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--qa-text)' }}>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...btnSecondary, padding: '2px 8px', fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, help, children }: { label: string; help?: string | null; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text-2)' }}>{label} <span style={{ color: 'var(--fail)' }}>*</span></span>
      {children}
      {help && <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>{help}</span>}
    </label>
  );
}

export function Banner({ kind, children }: { kind: 'info' | 'error'; children: React.ReactNode }) {
  const bad = kind === 'error';
  return <div role={bad ? 'alert' : 'status'} style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--qa-border)', background: bad ? 'var(--fail-soft)' : 'var(--qa-gray-50)', color: bad ? 'var(--fail)' : 'var(--qa-text-2)' }}>{children}</div>;
}

export function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`roster-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div style={{ padding: '40px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: 'var(--qa-text)' }}>{title}</div><div style={{ fontSize: 13, color: 'var(--qa-text-3)', marginTop: 4 }}>{body}</div></div>;
}
