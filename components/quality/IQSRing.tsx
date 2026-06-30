'use client';

import React from 'react';
import { iqsTheme } from '@/lib/quality';

interface IQSRingProps {
  iqs: number;
  size?: number;
}

export function IQSRing({ iqs, size = 56 }: IQSRingProps) {
  const t = iqsTheme(iqs);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (iqs / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.bar} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color: t.text }}>{iqs}%</span>
    </div>
  );
}

interface IQSPillProps {
  iqs: number;
  size?: 'sm' | 'lg';
}

export function IQSPill({ iqs, size = 'sm' }: IQSPillProps) {
  const t = iqsTheme(iqs);
  if (size === 'lg') return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-sm"
      style={{ background: t.bg, color: t.text }}>
      {iqs}%
      <span className="text-[10px] font-medium opacity-70">{t.label}</span>
    </span>
  );
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold tabular-nums"
      style={{ background: t.bg, color: t.text }}>{iqs}%</span>
  );
}
