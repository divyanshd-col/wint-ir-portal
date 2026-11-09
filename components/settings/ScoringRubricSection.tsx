'use client';

import { useState } from 'react';
import { DEFAULT_EMAIL_PARAMETERS, type EvaluationParameterConfig } from '@/lib/email/context-builder';

interface Row { key: string; name: string; weight: string; description: string; instructions: string }

const toRows = (params: EvaluationParameterConfig[]): Row[] =>
  params.map(p => ({ key: p.key, name: p.name, weight: String(p.defaultWeight), description: p.description, instructions: p.instructions }));

const field = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30';

/** Settings → Scoring Rubric: the email QA parameters (name, weight, help text, and what the evaluator is told). */
export default function ScoringRubricSection({ initial, onSaved }: { initial: EvaluationParameterConfig[]; onSaved: (msg: string) => void }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [saved, setSaved] = useState<string>(() => JSON.stringify(toRows(initial)));
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.001;
  const badWeight = rows.some(r => r.weight.trim() === '' || !(Number(r.weight) >= 0 && Number(r.weight) <= 100));
  const empty = rows.some(r => !r.name.trim() || !r.description.trim() || !r.instructions.trim());
  const dirty = JSON.stringify(rows) !== saved;

  async function save(payload: Record<string, unknown>, next: Row[], message: string) {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailRubric: payload }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not save'); return; }
      setRows(next); setSaved(JSON.stringify(next));
      onSaved(message);
    } catch { setError('Could not save'); } finally { setSaving(false); }
  }

  const onSave = () => save(
    Object.fromEntries(rows.map(r => [r.key, { name: r.name, weight: Number(r.weight), description: r.description, instructions: r.instructions }])),
    rows, 'Scoring rubric saved',
  );
  const onReset = () => save({}, toRows(DEFAULT_EMAIL_PARAMETERS), 'Scoring rubric reset to defaults');

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-gray-900">Scoring Rubric</h2>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Email QA parameters</h3>
          <p className="text-xs text-gray-400 mt-0.5 max-w-2xl">
            Each email reply is scored Yes / Half / No / N/A on these parameters, and the IQS is their weighted average (N/A is left out).
            The weights must add up to 100. The instructions are exactly what the AI evaluator is told. Changes apply to emails evaluated
            after you save; scores already stored are not recalculated.
          </p>
        </div>

        <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
          {rows.map((r, i) => {
            const isOpen = open === r.key;
            return (
              <div key={r.key} className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4 text-right">{i + 1}</span>
                  <input aria-label={`${r.name} name`} value={r.name} onChange={e => set(r.key, { name: e.target.value })} className={`${field} flex-1`} />
                  <label className="flex items-center gap-1.5 text-xs text-gray-400">
                    Weight
                    <input
                      aria-label={`${r.name} weight`} type="number" min={0} max={100} step={1} value={r.weight}
                      onChange={e => set(r.key, { weight: e.target.value })} className="w-20 border border-gray-200 rounded-xl px-3 py-2 text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
                    />
                  </label>
                  <button type="button" onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen} className="text-xs text-[#1f7a4d] font-semibold hover:underline w-16 text-right">
                    {isOpen ? 'Hide' : 'Edit text'}
                  </button>
                </div>
                {isOpen && (
                  <div className="space-y-3 pl-7">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Help text shown to QA, TLs and agents</label>
                      <textarea value={r.description} onChange={e => set(r.key, { description: e.target.value })} rows={2} className={field} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Instructions to the AI evaluator</label>
                      <textarea value={r.instructions} onChange={e => set(r.key, { instructions: e.target.value })} rows={14} className={`${field} font-mono text-xs leading-relaxed`} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className={`text-sm font-semibold ${totalOk ? 'text-emerald-600' : 'text-red-600'}`}>
            Total weight: {Math.round(total * 100) / 100} / 100
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onReset} disabled={saving} className="text-xs text-gray-400 hover:text-gray-600 underline disabled:opacity-50">Reset to defaults</button>
            <button
              onClick={onSave} disabled={saving || !dirty || !totalOk || badWeight || empty}
              className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition"
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {empty && <p className="text-xs text-red-600">Name, help text and instructions cannot be empty.</p>}
      </div>

      <p className="text-xs text-gray-400 max-w-xl">
        Chat and call weights and rubrics are still defined in code and are not editable here yet.
      </p>
    </div>
  );
}
