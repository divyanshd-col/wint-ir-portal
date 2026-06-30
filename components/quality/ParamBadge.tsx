'use client';

import React from 'react';
import type { ParamScore } from '@/lib/quality';

export default function ParamBadge({ val }: { val: ParamScore | string | undefined }) {
  if (val === 'Yes') return <span className="text-emerald-500 font-bold text-sm">✓</span>;
  if (val === 'No')  return <span className="text-red-500 font-bold text-sm">✗</span>;
  return <span className="text-gray-300 text-sm">—</span>;
}
