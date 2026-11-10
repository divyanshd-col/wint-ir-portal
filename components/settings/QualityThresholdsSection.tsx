'use client';

import { useState } from 'react';
import { DEFAULT_QUALITY_THRESHOLDS, type QualityThresholds } from '@/lib/quality-thresholds';

const ROWS: { key: keyof QualityThresholds; label: string; rule: string }[] = [
  { key: 'chatReview', label: 'Chats', rule: 'Chats with an IQS at or below this go to QA review. Chats with no IQS but a bad CSAT go too.' },
  { key: 'callReview', label: 'Calls', rule: 'Calls with an IQS at or below this go to QA review. Calls with a critical compliance failure always go.' },
  { key: 'emailReview', label: 'Emails', rule: 'Emails with an IQS at or below this go to QA review. Emails with no score or a compliance failure always go.' },
];

/** Settings → Quality Thresholds: the IQS at or below which a chat, call or email lands in the QA Pending Review queue. */
export default function QualityThresholdsSection({ initial, onSaved }: { initial: QualityThresholds; onSaved: (msg: string) => void }) {
  const [vals, setVals] = useState<Record<keyof QualityThresholds, string>>({
    chatReview: String(initial.chatReview), callReview: String(initial.callReview), emailReview: String(initial.emailReview),
  });
  const [saved, setSaved] = useState<QualityThresholds>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const num = (k: keyof QualityThresholds) => (vals[k].trim() === '' ? NaN : Number(vals[k]));
  const invalid = ROWS.some(r => !(num(r.key) >= 0 && num(r.key) <= 100));
  const dirty = ROWS.some(r => num(r.key) !== saved[r.key]);

  async function save(next: QualityThresholds) {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qualityThresholds: next }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not save'); return; }
      setSaved(next);
      setVals({ chatReview: String(next.chatReview), callReview: String(next.callReview), emailReview: String(next.emailReview) });
      onSaved('Quality thresholds saved');
    } catch { setError('Could not save'); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-gray-900">Quality Thresholds</h2>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900">QA review threshold</h3>
          <p className="text-xs text-gray-400 mt-0.5">The IQS (0–100) at or below which an item appears in QA Pending Review. Applies straight away; nothing already stored is changed.</p>
        </div>

        {ROWS.map(r => (
          <div key={r.key} className="flex items-center justify-between gap-6 border-t border-gray-100 pt-4 first:border-0 first:pt-0">
            <div className="min-w-0">
              <label htmlFor={`thr-${r.key}`} className="text-sm font-semibold text-gray-900">{r.label}</label>
              <p className="text-xs text-gray-400 mt-0.5">{r.rule}</p>
            </div>
            <input
              id={`thr-${r.key}`} type="number" min={0} max={100} step={1} value={vals[r.key]}
              onChange={e => setVals(v => ({ ...v, [r.key]: e.target.value }))}
              className="w-24 shrink-0 border border-gray-200 rounded-xl px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
            />
          </div>
        ))}

        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => save({ chatReview: num('chatReview'), callReview: num('callReview'), emailReview: num('emailReview') })}
            disabled={saving || invalid || !dirty}
            className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition"
          >{saving ? 'Saving…' : 'Save'}</button>
          <button
            onClick={() => save(DEFAULT_QUALITY_THRESHOLDS)} disabled={saving}
            className="text-xs text-gray-400 hover:text-gray-600 underline disabled:opacity-50"
          >Reset all to 85</button>
          {invalid && <span className="text-xs text-red-600">Each value must be a number from 0 to 100.</span>}
        </div>
      </div>

      <p className="text-xs text-gray-400 max-w-xl">
        The colour bands (green from 85, amber from 70) and the report cut-offs are separate and are not changed here.
      </p>
    </div>
  );
}
