import React from 'react';

interface Props {
  data:    { total: number; chats: number; calls: number; emails: number } | null;
  loading: boolean;
}

export default function PendingReviewCard({ data, loading }: Props) {
  const total  = data?.total  ?? 0;
  const chats  = data?.chats  ?? 0;
  const calls  = data?.calls  ?? 0;
  const emails = data?.emails ?? 0;

  return (
    <div style={{
      background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
      borderRadius: 8, padding: 20, minHeight: 132,
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 12 }}>
        Pending Review
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', width: '100%' }}>
        {loading ? (
          <div style={{ width: 80, height: 40, background: 'var(--qa-fill-light)', borderRadius: 4 }} />
        ) : (
          <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--qa-text)', lineHeight: 1 }}>
            {total.toLocaleString()}
          </span>
        )}

        {/* Channel split */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {[
            { label: 'Chats', value: chats },
            { label: 'Calls', value: calls },
            { label: 'Emails', value: emails || null },
          ].map((ch, i) => (
            <React.Fragment key={ch.label}>
              {i > 0 && <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--qa-border)', margin: '2px 0' }} />}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1 }}>
                <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--qa-text)', fontFamily: 'ui-monospace, monospace' }}>
                  {loading ? '—' : ch.value != null ? ch.value.toLocaleString() : '—'}
                </span>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)', marginTop: 2 }}>
                  {ch.label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
