import { paramChoice, paramLabel, type ParamChoice } from '@/lib/email/ui';
import AutoTextarea from './AutoTextarea';

const OPTIONS: { val: ParamChoice; label: string }[] = [
  { val: 'yes', label: 'Yes' },
  { val: 'half', label: 'Half' },
  { val: 'no', label: 'No' },
  { val: 'na', label: 'NA' },
];

/**
 * One evaluation parameter, laid out like the chat evaluation panel: name on the left, Yes / Half / No (/ NA) buttons and the
 * weight on the same line, the AI reasoning underneath. Pass `onChange` to make it editable (QA); without it the buttons are
 * a read-only display (TL, agent). `description` is shown as a tooltip on the name.
 */
export default function ParamScoreRow({
  name,
  description,
  value,
  allowNA,
  weight,
  reason,
  onChange,
  onReasonChange,
  last,
  disputed,
}: {
  name: string;
  description?: string;
  value: unknown;
  allowNA?: boolean;
  weight: number;
  reason?: string;
  onChange?: (v: ParamChoice) => void;
  onReasonChange?: (r: string) => void;
  last?: boolean;
  disputed?: boolean;
}) {
  const selected = paramChoice(value);
  const editable = Boolean(onChange);
  const canEditReason = Boolean(onReasonChange);
  const options = allowNA ? OPTIONS : OPTIONS.filter(o => o.val !== 'na');
  // a stored value that is none of the four (numeric, missing) is shown as text when read-only
  const asText = !editable && selected === null;

  return (
    <div style={{ padding: '14px 16px', borderBottom: last ? 'none' : '1px solid var(--qa-border-sub)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span title={description} style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0, color: 'var(--qa-text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {name}
          {disputed && (
            <span style={{
              height: 18, padding: '0 6px', borderRadius: 4,
              background: '#fef2f2', border: '1px solid #fecaca',
              color: '#991b1b', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              display: 'inline-flex', alignItems: 'center',
            }}>
              Disputed
            </span>
          )}
        </span>
        {asText ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)', fontFamily: 'ui-monospace, monospace' }}>{paramLabel(value)}</span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {options.map(({ val, label }) => {
              const isSel = selected === val;
              return (
                <button
                  key={val}
                  type="button"
                  disabled={!editable}
                  onClick={() => onChange?.(val)}
                  style={{
                    height: 28, padding: '0 9px', borderRadius: 8,
                    border: '1px solid var(--qa-border)',
                    background: isSel ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                    color: isSel ? 'var(--qa-on-text, #fff)' : 'var(--qa-text-2)',
                    fontSize: 12, fontFamily: 'inherit',
                    cursor: editable ? 'pointer' : 'default',
                    opacity: !editable && !isSel ? 0.4 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontFamily: 'ui-monospace, monospace', flexShrink: 0, minWidth: 32, textAlign: 'right' }}>
          {weight}%
        </span>
      </div>
      {(reason || canEditReason) && (
        canEditReason ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qa-text-3)', marginBottom: 4 }}>
              Reasoning:
            </div>
            <AutoTextarea
              value={reason || ''}
              onChange={e => onReasonChange?.(e.target.value)}
              placeholder="Reasoning for this parameter score…"
              rows={reason ? Math.max(2, Math.min(8, (reason.match(/\n/g) || []).length + 1)) : 2}
              style={{
                width: '100%',
                resize: 'vertical',
                border: '1px solid var(--qa-border)',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 12,
                color: 'var(--qa-text)',
                lineHeight: 1.5,
                fontFamily: 'inherit',
                background: 'var(--qa-card, #fff)',
                outline: 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                cursor: 'text',
                boxSizing: 'border-box',
                minHeight: 40,
              }}
              onFocus={e => {
                e.target.style.borderColor = 'var(--qa-text)';
                e.target.style.boxShadow = '0 0 0 1px var(--qa-text)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'var(--qa-border)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
        ) : (
          <div style={{ marginTop: 8, padding: '6px 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--qa-text-2)' }}>
            <span style={{ fontWeight: 600, color: 'var(--qa-text-3)', marginRight: 4 }}>Reason:</span>
            {reason}
          </div>
        )
      )}
    </div>
  );
}
