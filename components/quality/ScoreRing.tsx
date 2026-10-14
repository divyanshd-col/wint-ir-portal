/** IQS ring used in the email detail panels (agent and TL views): neutral ring, whole-number score in the middle. */
export default function ScoreRing({ score }: { score: number | string | null | undefined }) {
  const has = score != null && score !== '';
  const val = has ? Math.round(Number(score)) : 0;
  const r = 27;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={64} height={64} style={{ flexShrink: 0 }} role="img" aria-label={has ? `IQS ${val}` : 'No score yet'}>
      <circle cx={32} cy={32} r={r} stroke="var(--qa-border)" strokeWidth={5} fill="none" />
      <circle
        cx={32} cy={32} r={r}
        stroke="var(--qa-gray-700)" strokeWidth={5} fill="none" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ - (Math.max(0, Math.min(100, val)) / 100) * circ}
        transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 0.3s' }}
      />
      <text x={32} y={33} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={700} fill="var(--qa-text)">
        {has ? val : '—'}
      </text>
    </svg>
  );
}
