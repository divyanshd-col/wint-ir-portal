interface Props {
  data:    { chat: number | null; call: number | null; email: null } | null;
  loading: boolean;
}

const RADIUS = 27;
const CIRC   = 2 * Math.PI * RADIUS; // ≈ 169.6

function Ring({ value, label }: { value: number | null; label: string }) {
  const offset = value != null ? CIRC * (1 - value / 100) : CIRC;
  const hasData = value != null;

  return (
    <div>
      <div style={{ width: 64, height: 64, position: 'relative' }}>
        <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="32" cy="32" r={RADIUS} stroke="var(--qa-fill-med)" strokeWidth="6" fill="none" />
          {hasData && (
            <circle
              cx="32" cy="32" r={RADIUS}
              stroke="var(--qa-gray-700)" strokeWidth="6" fill="none"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          )}
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: hasData ? 'var(--qa-text)' : 'var(--qa-text-3)',
        }}>
          {hasData ? value : '—'}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--qa-text-2)', textAlign: 'center', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

export default function IQSRingCard({ data, loading }: Props) {
  return (
    <div style={{
      background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
      borderRadius: 8, padding: 20, minHeight: 132,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
          CX IQS
        </div>
        <div style={{ fontSize: 13, color: 'var(--qa-text-2)', marginTop: 0 }}>
          Quality score, split by channel
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {loading ? (
          [1,2,3].map(i => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--qa-fill-light)' }} />
              <div style={{ width: 32, height: 10, background: 'var(--qa-fill-light)', borderRadius: 4 }} />
            </div>
          ))
        ) : (
          <>
            <Ring value={data?.chat  ?? null} label="Chats" />
            <Ring value={data?.call  ?? null} label="Calls" />
            <Ring value={null}                label="Emails" />
          </>
        )}
      </div>
    </div>
  );
}
