'use client';

import { useState } from 'react';
import { splitPrompt, joinPrompt } from '@/lib/prompt-overrides';

export interface PromptEditorField { field: string; label?: string; value: string; defaultValue: string }

/** One editable prompt (or a few related blocks) in Settings → Prompts. Shows the saved text or the built-in default,
 *  a "Custom" badge when an override is saved, and Reset to default. Saving text identical to the default clears the override,
 *  so later improvements to the default still reach it. */
export default function PromptEditor({ title, description, note, fields, rows = 28, onSaved, preview, lockedOutput, viewOnly = false }: {
  title: string; description: string; note?: string; fields: PromptEditorField[]; rows?: number; onSaved: (msg: string) => void;
  /** Builds the full text the AI receives from the current (even unsaved) edits; shown read-only under the editor. */
  preview?: { label: string; build: (texts: Record<string, string>) => string };
  /** Fixed output format that lives in code (not part of the saved text); shown read-only below the editors. */
  lockedOutput?: string;
  /** No Edit or Reset buttons: the prompt is shown for reading only. */
  viewOnly?: boolean;
}) {
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.field, splitPrompt(f.value || f.defaultValue).editable])));
  const [saved, setSaved] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.field, f.value])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const isCustom = fields.some(f => saved[f.field]?.trim());
  const full = (f: PromptEditorField) => joinPrompt(texts[f.field], splitPrompt(f.defaultValue).locked);
  const dirty = fields.some(f => full(f) !== (saved[f.field]?.trim() ? saved[f.field] : f.defaultValue));

  async function patch(values: Record<string, string>, nextTexts: Record<string, string>, message: string) {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not save'); return; }
      setSaved(values); setTexts(nextTexts); setEditing(false); onSaved(message);
    } catch { setError('Could not save'); } finally { setSaving(false); }
  }

  const onSave = () => patch(
    Object.fromEntries(fields.map(f => [f.field, full(f).trim() === f.defaultValue.trim() ? '' : full(f)])),
    texts, `${title} prompt saved`,
  );
  const onCancel = () => {
    setTexts(Object.fromEntries(fields.map(f => [f.field, splitPrompt(saved[f.field]?.trim() ? saved[f.field] : f.defaultValue).editable])));
    setError(''); setEditing(false);
  };
  const onReset = () => patch(
    Object.fromEntries(fields.map(f => [f.field, ''])),
    Object.fromEntries(fields.map(f => [f.field, splitPrompt(f.defaultValue).editable])), `${title} prompt reset to default`,
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
        {isCustom
          ? <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Custom</span>
          : <span className="shrink-0 text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">Default</span>}
      </div>

      {fields.map(f => (
        <div key={f.field}>
          {f.label && <label htmlFor={`prompt-${f.field}`} className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{f.label}</label>}
          <textarea
            id={`prompt-${f.field}`} value={texts[f.field]} onChange={e => setTexts(t => ({ ...t, [f.field]: e.target.value }))}
            readOnly={!editing} aria-readonly={!editing}
            rows={fields.length > 1 ? Math.min(rows, 12) : rows}
            className={`w-full border rounded-xl px-4 py-3 text-sm font-mono leading-relaxed resize-y focus:outline-none ${editing
              ? 'border-gray-200 text-gray-700 bg-white focus:ring-2 focus:ring-[#1f7a4d]/30'
              : 'border-gray-100 text-gray-600 bg-gray-50 cursor-default'}`}
          />
          {splitPrompt(f.defaultValue).locked && <LockedBox id={f.field} text={splitPrompt(f.defaultValue).locked} />}
        </div>
      ))}

      {lockedOutput && <LockedBox id="output" text={lockedOutput} />}

      {preview && (
        <details className="group border border-gray-100 rounded-xl">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-gray-600 hover:text-gray-900">{preview.label}</summary>
          <textarea readOnly value={preview.build(texts)} rows={24} aria-label={preview.label}
            className="w-full border-t border-gray-100 rounded-b-xl px-4 py-3 text-sm text-gray-600 bg-gray-50 font-mono leading-relaxed resize-y focus:outline-none" />
        </details>
      )}

      {note && <p className="text-xs text-gray-400">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        {viewOnly ? null : editing ? (
          <>
            <button onClick={onSave} disabled={saving || !dirty}
              className="px-6 py-2.5 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button onClick={onCancel} disabled={saving}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 transition">Cancel</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}
            className="px-6 py-2.5 border border-[#1f7a4d] text-[#1f7a4d] rounded-xl text-sm font-semibold hover:bg-green-50 transition">Edit</button>
        )}
        {isCustom && !viewOnly && (
          <button onClick={onReset} disabled={saving} className="text-xs text-gray-400 hover:text-gray-600 underline transition disabled:opacity-50">Reset to default</button>
        )}
      </div>
    </div>
  );
}

function LockedBox({ id, text }: { id: string; text: string }) {
  return (
    <div className="mt-3">
      <label htmlFor={`locked-${id}`} className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Output format <span className="normal-case font-normal text-gray-400">(locked, set in code so scoring cannot break)</span></label>
      <textarea id={`locked-${id}`} readOnly value={text} rows={12}
        className="w-full border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-500 bg-gray-50 font-mono leading-relaxed resize-y cursor-not-allowed focus:outline-none" />
    </div>
  );
}
