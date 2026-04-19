'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

interface WoWDataPoint {
  week_start: string;
  qa: number | null;
  csat: number | null;
  volume: number | null;
  in_progress?: boolean;
}

interface WoWChartProps {
  data: WoWDataPoint[];
  metrics: ('qa' | 'csat' | 'volume')[];
}

const METRIC_COLORS = {
  qa:     '#3b82f6', // blue
  csat:   '#10b981', // emerald
  volume: '#f59e0b', // amber
};

const METRIC_LABELS = {
  qa:     'QA Score',
  csat:   'CSAT',
  volume: 'Volume',
};

function formatWeek(weekStart: string): string {
  const d = new Date(weekStart);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload.in_progress) return null;
  return <circle cx={cx} cy={cy} r={4} fill="#6366f1" stroke="#6366f1" strokeWidth={2} strokeDasharray="3 3" />;
};

export default function WoWChart({ data, metrics }: WoWChartProps) {
  const inProgressWeek = data.find(d => d.in_progress)?.week_start;

  const formatted = data.map(d => ({
    ...d,
    week: formatWeek(d.week_start),
  }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={formatted} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff12" />
          <XAxis
            dataKey="week"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#ffffff15' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{ background: '#1e1e1e', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            itemStyle={{ color: '#e5e7eb' }}
            formatter={(value: any, name: any) => {
              if (value === null || value === undefined) return ['—', name ?? ''];
              return [typeof value === 'number' ? value.toFixed(2) : value, name ?? ''];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: '#9ca3af', paddingTop: 8 }}
          />
          {inProgressWeek && (
            <ReferenceLine
              x={formatWeek(inProgressWeek)}
              stroke="#6366f1"
              strokeDasharray="4 4"
              label={{ value: 'In progress', position: 'top', fill: '#818cf8', fontSize: 10 }}
            />
          )}
          {metrics.map(m => (
            <Line
              key={m}
              type="monotone"
              dataKey={m}
              name={METRIC_LABELS[m]}
              stroke={METRIC_COLORS[m]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              connectNulls={false}
              strokeDasharray={m === 'qa' && inProgressWeek ? undefined : undefined}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
