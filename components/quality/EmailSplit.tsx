import React from 'react';

/**
 * Inline e-mail review layout shared by the TL views: conversation on the left, evaluation (or dispute) on the right,
 * fixed 1.35 : 1 proportions with each pane scrolling on its own, exactly like the chat and call panels.
 */
export default function EmailSplit({ conversation, scoring }: { conversation: React.ReactNode; scoring: React.ReactNode }) {
  return (
    <div className="eval-wrap" style={{ width: '100%', maxWidth: '100%', margin: '16px auto', boxSizing: 'border-box', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)' }}>
      <div className="eval-pane">
        <div className="eval-scroll-t" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>{conversation}</div>
      </div>
      <div className="eval-pane">
        <div className="eval-scroll-r" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>{scoring}</div>
      </div>
    </div>
  );
}
