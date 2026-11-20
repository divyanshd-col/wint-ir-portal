'use client';

import { useState } from 'react';

/** Settings → PCG → Email Inbox: the Robylon inboxes that belong to PCG. Their emails are stored in the PCG tables and never enter the CX email pipeline. */
export default function PcgEmailInboxSection({ initial, onSaved }: { initial: string[]; onSaved: (msg: string) => void }) {
  const [text, setText] = useState(initial.join('\n'));
  const [saved, setSaved] = useState(initial.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pcgEmailInboxes: text }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not save'); return; }
      const clean = text.split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      const next = Array.from(new Set(clean)).join('\n');
      setText(next); setSaved(next);
      onSaved('PCG email inboxes saved');
    } catch { setError('Could not save'); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-gray-900">Email Inbox</h2>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900">PCG email inboxes</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Robylon sends every email event to one webhook. Emails sent to an inbox listed here are stored for PCG (as received) and skip the CX email
            processing, scoring and SLA reports. Every other inbox stays CX. One address per line.
          </p>
        </div>
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={4} spellCheck={false} aria-label="PCG email inboxes"
          placeholder="one inbox address per line"
          className="w-full max-w-md border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
        />
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <p className="text-xs text-gray-400">
          Until a list is saved here, PCG's three built-in inboxes apply. A saved list replaces them, so keep every PCG inbox on it. An inbox that carries most of the CX emails is refused, because it would move them out of CX.
        </p>
        <button
          onClick={save} disabled={saving || text === saved}
          className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition"
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
