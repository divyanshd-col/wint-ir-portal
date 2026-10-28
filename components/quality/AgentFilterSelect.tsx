'use client';
import React from 'react';
import UISelect from './UISelect';

export interface AgentFilterOption { value: string; label: string }

/** Interaction filter (All / Human Only / …). Lives in each queue's filter bar. */
export default function AgentFilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: AgentFilterOption[];
}) {
  return (
    <UISelect aria-label="Interaction filter" value={value} onChange={e => onChange(e.target.value)} style={{ minWidth: 150 }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </UISelect>
  );
}
