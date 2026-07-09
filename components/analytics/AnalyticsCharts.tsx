'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';

interface ChartProps {
  data: any[];
  unit?: string;
  GREEN: string;
}

export function AnalyticsBarChart({ data, unit, GREEN }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={Math.min(260, data.length * 36 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
          tickFormatter={v => unit === '%' ? `${v}%` : String(v)} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} width={90} />
        <Tooltip
          formatter={(v: any) => [unit ? `${v}${unit}` : v, '']}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Bar dataKey="value" fill={GREEN} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AnalyticsLineChart({ data, unit, GREEN }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
          tickFormatter={v => String(v).slice(5)} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: any) => [unit ? `${v}${unit}` : v, '']}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Line type="monotone" dataKey="value" stroke={GREEN} strokeWidth={2} dot={{ r: 3, fill: GREEN }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
