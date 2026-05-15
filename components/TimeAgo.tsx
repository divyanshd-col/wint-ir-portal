'use client';

export default function TimeAgo({ ts }: { ts: number | string }) {
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (isNaN(ms)) return null;
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return <span>just now</span>;
  if (m < 60) return <span>{m}m ago</span>;
  const h = Math.floor(m / 60);
  if (h < 24) return <span>{h}h ago</span>;
  const d = Math.floor(h / 24);
  if (d < 7)  return <span>{d}d ago</span>;
  const label = new Date(ms).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
  return <span>{label}</span>;
}
