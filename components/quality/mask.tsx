import React from 'react';

// Secrets that show up in Robylon internal notes (API keys, JWTs) are masked wherever notes are rendered.
const SECRET_RE = /\b((?:[a-z]{2,4}_(?:live|test)_[A-Za-z0-9]{8,})|(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+))\b/g;
const maskLabel = (m: string) => (m.startsWith('eyJ') ? 'eyJ' : m.replace(/(_(?:live|test)_).*/, '$1')) + '••••••••';

export const maskText = (t: string) => t.replace(SECRET_RE, m => maskLabel(m));

export function renderMasked(t: string): React.ReactNode[] {
  return t.split(SECRET_RE).map((part, i) => (i % 2 ? <span key={i} className="eval-mask">{maskLabel(part)}</span> : part));
}
