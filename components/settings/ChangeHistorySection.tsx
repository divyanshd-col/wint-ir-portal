'use client';

import { useEffect, useState } from 'react';

interface Row { id: number; key: string; label: string; action: 'save' | 'restore'; changedBy: string; changedAt: string; oldChars: number | null; newChars: number | null }
type Value = string | Record<string, unknown> | null;
interface Detail { oldValue: Value; newValue: Value }

const show = (v: Value) => (v === null ? null : typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const what = (r: Row) => (r.action === 'restore' ? 'Restored' : r.newChars === null ? 'Reset to default' : 'Saved');
const size = (r: Row) => `${r.oldChars === null ? 'default' : `${r.oldChars.toLocaleString()} chars`} → ${r.newChars === null ? 'default' : `${r.newChars.toLocaleString()} chars`}`;

/** Settings → Change History: every change to a prompt, the email rubric or the thresholds, with the text before and after.
 *  Either side can be restored. A restore is itself recorded, so nothing is ever lost. */
export default function ChangeHistorySection({ workspace, active }: { workspace: 'cx' | 'pcg'; active: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [confirm, setConfirm] = useState<{ id: number; side: 'old' | 'new' } | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload the list each time the screen is opened, so changes saved in other sections show up.
  useEffect(() => {
    if (!active) return;
    let live = true;
    fetch(`/api/settings-history?workspace=${workspace}`)
      .then(async r => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'Could not load the history'); return b; })
      .then(b => { if (live) { setRows(b.rows); setError(''); } })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [active, workspace]);

  async function open(id: number) {
    setConfirm(null);
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (details[id]) return;
    try {
      const r = await fetch(`/api/settings-history?id=${id}`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not load this change');
      setDetails(d => ({ ...d, [id]: { oldValue: b.entry.oldValue, newValue: b.entry.newValue } }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this change'); }
  }

  async function restore(id: number, side: 'old' | 'new') {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/settings-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, side }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setError(b.error || 'Could not restore'); return; }
      window.location.reload();   // every editor on the page re-reads the restored value
    } catch { setError('Could not restore'); } finally { setBusy(false); }
  }

  const side = (r: Row, which: 'old' | 'new', value: Value) => {
    const text = show(value);
    const isConfirming = confirm?.id === r.id && confirm.side === which;
    return (
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{which === 'old' ? 'Before' : 'After'}</p>
        {text === null
          ? <p className="text-xs italic text-gray-400 border border-dashed border-gray-200 rounded-xl px-3 py-2">Built-in default</p>
          : <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-xl p-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono">{text}</pre>}
        <div className="mt-2 flex items-center gap-2">
          {isConfirming ? (
            <>
              <span className="text-xs text-gray-500">Replace the current setting with this?</span>
              <button onClick={() => restore(r.id, which)} disabled={busy} className="px-3 py-1.5 bg-[#1f7a4d] text-white rounded-lg text-xs font-semibold hover:bg-[#1a6a42] disabled:opacity-50">{busy ? 'Restoring…' : 'Yes, restore'}</button>
              <button onClick={() => setConfirm(null)} disabled={busy} className="text-xs text-gray-400 hover:text-gray-600 underline">Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirm({ id: r.id, side: which })} className="text-xs text-[#1f7a4d] font-semibold hover:underline">
              {text === null ? 'Restore the built-in default' : 'Restore this text'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-gray-900">Change History</h2>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Prompts, scoring rubric and thresholds</h3>
          <p className="text-xs text-gray-400 mt-0.5 max-w-2xl">
            Every save is recorded with who made it and the text before and after. Open a change to compare, and restore either version. A restore is recorded too.
            History starts from the first change made after this was added.
          </p>
        </div>

        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {rows === null && !error && <p className="text-xs text-gray-400">Loading…</p>}
        {rows?.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No changes recorded yet.</p>}

        {rows && rows.length > 0 && (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
            {rows.map(r => {
              const isOpen = openId === r.id; const d = details[r.id];
              return (
                <div key={r.id}>
                  <button onClick={() => open(r.id)} aria-expanded={isOpen} className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50">
                    <span className="text-xs text-gray-400 w-36 shrink-0">{when(r.changedAt)}</span>
                    <span className="text-sm font-medium text-gray-900 flex-1 min-w-0 truncate">{r.label}</span>
                    <span className="text-xs text-gray-500 w-28 shrink-0">{what(r)}</span>
                    <span className="text-xs text-gray-400 w-48 shrink-0 hidden md:block">{size(r)}</span>
                    <span className="text-xs text-gray-500 w-44 shrink-0 truncate hidden lg:block" title={r.changedBy}>{r.changedBy}</span>
                    <span className="text-xs text-gray-400 w-4 shrink-0">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4">
                      {d ? <div className="grid md:grid-cols-2 gap-4">{side(r, 'old', d.oldValue)}{side(r, 'new', d.newValue)}</div> : <p className="text-xs text-gray-400">Loading…</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
