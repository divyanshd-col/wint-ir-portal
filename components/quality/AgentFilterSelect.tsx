'use client';
import React from 'react';

export interface AgentFilterOption { value: string; label: string }

/** Interaction filter (All / Human Only / …). Lives in each queue's filter bar. */
export default function AgentFilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: AgentFilterOption[];
}) {
  return (
    <select
      aria-label="Interaction filter"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        height: 32, padding: '0 26px 0 10px',
        border: '1px solid var(--qa-border)', borderRadius: 8,
        background: 'var(--qa-card)', color: 'var(--qa-text)',
        fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', appearance: 'none',
        backgroundImage: 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23a1a1aa\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")',
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 9px center', backgroundSize: '12px',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: 'var(--qa-card)', color: 'var(--qa-text)' }}>{o.label}</option>
      ))}
    </select>
  );
}
