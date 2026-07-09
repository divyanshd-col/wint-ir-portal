'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';

interface InsightsBarChartProps {
  data: any[];
  unit?: string;
}

export function InsightsBarChart({ data, unit }: InsightsBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={Math.min(48 + data.length * 32, 360)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 28, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
          unit={unit ?? ''} />
        <YAxis type="category" dataKey="name" width={148} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: any) => [`${v}${unit ?? ''}`, 'Value']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
        />
        <Bar dataKey="value" fill="#2d6a4f" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface InsightsLineChartProps {
  data: any[];
  unit?: string;
}

export function InsightsLineChart({ data, unit }: InsightsLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 20, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f4" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit={unit ?? ''} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
        />
        <Line type="monotone" dataKey="value" stroke="#2d6a4f" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
