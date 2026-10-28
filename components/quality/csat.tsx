import React from 'react';

// Robylon's CSAT options are Good / Could be better / Bad, stored as 5 / 3 / 1.
export const CSAT_OPTIONS = [
  { value: '5', label: 'Good' },
  { value: '3', label: 'Could be better' },
  { value: '1', label: 'Bad' },
] as const;

export const csatLabel = (v: string | number | null | undefined): string | null => {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  if (s === '5' || s === 'good') return 'Good';
  if (s === '3' || s === 'could be better' || s === 'neutral') return 'Could be better';
  if (s === '1' || s === 'bad') return 'Bad';
  return null;
};

/** CSAT as a pill: green = Good, red = Bad, neutral = Could be better. Empty values render a quiet dash. */
export function CsatPill({ value }: { value: string | number | null | undefined }) {
  const label = csatLabel(value);
  if (!label) return <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>;
  const tone = label === 'Good' ? 'good' : label === 'Bad' ? 'bad' : 'mid';
  return <span className={`csat-pill ${tone}`}>{label}</span>;
}
