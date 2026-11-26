'use client';

import React, { useEffect, useState } from 'react';

export type AiAuditSelection = 'accurate' | 'hallucinated' | null;

interface AiEvaluationAuditBoxProps {
  type: 'call' | 'chat' | 'email';
  id: string;
  onSelectionChange?: (selection: AiAuditSelection) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: React.CSSProperties;
}

export default function AiEvaluationAuditBox({
  type,
  id,
  onSelectionChange,
  open: controlledOpen,
  onOpenChange,
  style,
}: AiEvaluationAuditBoxProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [auditSelection, setAuditSelection] = useState<AiAuditSelection>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    if (controlledOpen === undefined) setInternalOpen(next);
  };

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetch(`/api/cx/qa/mark-ai-audit?type=${type}&id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        const sel: AiAuditSelection =
          d.ai_hallucinated === true ? 'hallucinated' : d.ai_hallucinated === false ? 'accurate' : null;
        setAuditSelection(sel);
        onSelectionChange?.(sel);
        setReason(d.ai_hallucination_reason || '');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  const saveAudit = async (hallucinated: boolean | null, reasonText?: string) => {
    if (!id) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/cx/qa/mark-ai-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          id,
          ai_hallucinated: hallucinated,
          ai_hallucination_reason: reasonText !== undefined ? reasonText : reason,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (err) {
      console.error('[AiEvaluationAuditBox] Failed to save AI audit:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        marginBottom: 12,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        background: '#ffffff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isOpen ? '#f9fafb' : '#ffffff',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#4b5563"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
            AI Evaluation Audit <span style={{ color: '#dc2626' }}>*</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {auditSelection ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                padding: '2px 8px',
                borderRadius: 4,
                background: auditSelection === 'hallucinated' ? '#111827' : '#f3f4f6',
                color: auditSelection === 'hallucinated' ? '#ffffff' : '#374151',
                border: auditSelection === 'hallucinated' ? '1px solid #111827' : '1px solid #e5e7eb',
              }}
            >
              {auditSelection === 'hallucinated' ? 'AI Hallucinated' : 'AI Accurate'}
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>
              Required · Select AI accuracy
            </span>
          )}
          {saved && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#111827' }}>
              ✓ Saved
            </span>
          )}
        </div>
      </button>

      {isOpen && (
        <div
          style={{
            padding: '12px 14px',
            borderTop: '1px solid #e5e7eb',
            background: '#fafafa',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={auditSelection === 'accurate'}
                onChange={(e) => {
                  const next: AiAuditSelection = e.target.checked ? 'accurate' : null;
                  setAuditSelection(next);
                  onSelectionChange?.(next);
                  if (e.target.checked) {
                    saveAudit(false, '');
                  } else {
                    saveAudit(null, '');
                  }
                }}
                style={{ width: 15, height: 15, accentColor: '#111827', cursor: 'pointer' }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: auditSelection === 'accurate' ? 600 : 500,
                  color: '#111827',
                }}
              >
                AI Accurate
              </span>
            </label>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={auditSelection === 'hallucinated'}
                onChange={(e) => {
                  const next: AiAuditSelection = e.target.checked ? 'hallucinated' : null;
                  setAuditSelection(next);
                  onSelectionChange?.(next);
                  if (e.target.checked) {
                    saveAudit(true, reason);
                  } else {
                    saveAudit(null, '');
                  }
                }}
                style={{ width: 15, height: 15, accentColor: '#111827', cursor: 'pointer' }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: auditSelection === 'hallucinated' ? 600 : 500,
                  color: '#111827',
                }}
              >
                AI Hallucinated
              </span>
            </label>
          </div>

          {auditSelection === 'hallucinated' && (
            <div style={{ marginTop: 12 }}>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => saveAudit(true, reason)}
                placeholder="State reason why this evaluation was marked as AI hallucinated..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  background: '#ffffff',
                  color: '#111827',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveAudit(true, reason)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 5,
                    border: 'none',
                    background: '#111827',
                    color: '#ffffff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Saving...' : 'Save Reason'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
