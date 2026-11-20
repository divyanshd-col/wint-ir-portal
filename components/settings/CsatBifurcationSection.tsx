'use client';

import { useState, useMemo } from 'react';
import {
  type CsatBifurcationEntry,
  DEFAULT_CSAT_BIFURCATION,
  makeBifurcationKey,
} from '@/lib/csat-bifurcation';

interface Props {
  initial: CsatBifurcationEntry[];
  onSaved: (msg: string) => void;
}

export default function CsatBifurcationSection({ initial, onSaved }: Props) {
  const [items, setItems] = useState<CsatBifurcationEntry[]>(() => {
    return Array.isArray(initial) && initial.length > 0 ? initial : DEFAULT_CSAT_BIFURCATION;
  });
  const [savedItems, setSavedItems] = useState<CsatBifurcationEntry[]>(() => {
    return Array.isArray(initial) && initial.length > 0 ? initial : DEFAULT_CSAT_BIFURCATION;
  });
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'solvable' | 'unsolvable'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // New mapping form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDisp, setNewDisp] = useState('');
  const [newSubDisp, setNewSubDisp] = useState('');
  const [newType, setNewType] = useState<'solvable' | 'unsolvable'>('solvable');

  const solvableCount = useMemo(() => items.filter(i => i.type === 'solvable').length, [items]);
  const unsolvableCount = useMemo(() => items.filter(i => i.type === 'unsolvable').length, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      if (filterType !== 'all' && item.type !== filterType) return false;
      if (!q) return true;
      return (
        item.disposition.toLowerCase().includes(q) ||
        item.subDisposition.toLowerCase().includes(q)
      );
    });
  }, [items, search, filterType]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredItems.length);
  const paginatedItems = useMemo(
    () => filteredItems.slice(startIndex, endIndex),
    [filteredItems, startIndex, endIndex]
  );

  const paginationRange = useMemo<(number | '...')[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  }, [currentPage, totalPages]);

  const isDirty = useMemo(() => {
    if (items.length !== savedItems.length) return true;
    const savedMap = new Map(savedItems.map(i => [makeBifurcationKey(i.disposition, i.subDisposition), i.type]));
    for (const item of items) {
      const key = makeBifurcationKey(item.disposition, item.subDisposition);
      if (savedMap.get(key) !== item.type) return true;
    }
    return false;
  }, [items, savedItems]);

  const toggleType = (disposition: string, subDisposition: string) => {
    const key = makeBifurcationKey(disposition, subDisposition);
    setItems(prev =>
      prev.map(item => {
        if (makeBifurcationKey(item.disposition, item.subDisposition) === key) {
          return {
            ...item,
            type: item.type === 'solvable' ? 'unsolvable' : 'solvable',
          };
        }
        return item;
      })
    );
  };

  const handleAddNew = (e: React.FormEvent) => {
    e.preventDefault();
    const d = newDisp.trim();
    const s = newSubDisp.trim();
    if (!d || !s) return;

    const key = makeBifurcationKey(d, s);
    const existingIdx = items.findIndex(i => makeBifurcationKey(i.disposition, i.subDisposition) === key);

    if (existingIdx >= 0) {
      setItems(prev => {
        const next = [...prev];
        next[existingIdx] = { disposition: d, subDisposition: s, type: newType };
        return next;
      });
    } else {
      setItems(prev => [{ disposition: d, subDisposition: s, type: newType }, ...prev]);
    }

    setNewDisp('');
    setNewSubDisp('');
    setShowAddForm(false);
    setPage(1);
  };

  const handleSave = async (dataToSave = items) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csatBifurcationMap: dataToSave }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Failed to save CSAT bifurcation mapping');
        return;
      }
      setSavedItems(dataToSave);
      setItems(dataToSave);
      onSaved('CSAT Bifurcation mapping saved successfully');
    } catch {
      setError('Network error while saving CSAT bifurcation mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = () => {
    if (confirm('Reset all dispositions to default solvable/unsolvable mappings?')) {
      handleSave(DEFAULT_CSAT_BIFURCATION);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">CSAT Bifurcation</h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowAddForm(prev => !prev)}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition"
          >
            {showAddForm ? 'Cancel Add' : '+ Add Mapping'}
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving || !isDirty}
            className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition shadow-sm"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddNew} className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Add or Override Mapping</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Disposition</label>
              <input
                type="text"
                required
                value={newDisp}
                onChange={e => setNewDisp(e.target.value)}
                placeholder="e.g. KYC"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Sub-Disposition</label>
              <input
                type="text"
                required
                value={newSubDisp}
                onChange={e => setNewSubDisp(e.target.value)}
                placeholder="e.g. Bank Account linking issues"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Classification</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as any)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="solvable">Solvable</option>
                <option value="unsolvable">Unsolvable</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition"
            >
              Add Pair
            </button>
          </div>
        </form>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl text-xs font-medium self-start">
            <button
              type="button"
              onClick={() => { setFilterType('all'); setPage(1); }}
              className={`px-3 py-1 rounded-lg transition ${filterType === 'all' ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => { setFilterType('solvable'); setPage(1); }}
              className={`px-3 py-1 rounded-lg transition ${filterType === 'solvable' ? 'bg-white text-emerald-800 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Solvable ({solvableCount})
            </button>
            <button
              type="button"
              onClick={() => { setFilterType('unsolvable'); setPage(1); }}
              className={`px-3 py-1 rounded-lg transition ${filterType === 'unsolvable' ? 'bg-white text-amber-800 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Unsolvable ({unsolvableCount})
            </button>
          </div>

          <div className="relative min-w-[240px]">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search disposition or sub-disposition..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white transition"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

        {/* Table */}
        <div className="overflow-x-auto border border-gray-100 rounded-xl">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-semibold uppercase text-[10px] tracking-wider">
                <th className="px-4 py-3">Disposition</th>
                <th className="px-4 py-3">Sub-Disposition</th>
                <th className="px-4 py-3 text-right">Mapping</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                    No matching dispositions found.
                  </td>
                </tr>
              ) : (
                paginatedItems.map(item => {
                  const isSolvable = item.type === 'solvable';
                  return (
                    <tr key={`${item.disposition}__${item.subDisposition}`} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {item.disposition}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {item.subDisposition}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleType(item.disposition, item.subDisposition)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition border ${isSolvable
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                            }`}
                          title="Click to toggle between Solvable and Unsolvable"
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${isSolvable ? 'bg-emerald-500' : 'bg-amber-500'
                              }`}
                          />
                          {isSolvable ? 'Solvable' : 'Unsolvable'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Table Pagination Bar */}
          <div className="bg-gray-50/70 border-t border-gray-100 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-gray-500">
              Showing <span className="font-semibold text-gray-800">{filteredItems.length === 0 ? 0 : startIndex + 1}</span> to{' '}
              <span className="font-semibold text-gray-800">{endIndex}</span> of{' '}
              <span className="font-semibold text-gray-800">{filteredItems.length}</span> entries
              {filteredItems.length !== items.length && (
                <span className="text-gray-400 ml-1">(filtered from {items.length} total)</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs"
              >
                <span>←</span> Previous
              </button>

              <div className="flex items-center gap-1">
                {paginationRange.map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-1.5 text-gray-400 select-none">…</span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(Number(p))}
                      className={`min-w-[28px] h-7 px-2 flex items-center justify-center rounded-lg font-semibold text-xs transition ${currentPage === p
                        ? 'bg-[#1f7a4d] text-white shadow-2xs'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs"
              >
                Next <span>→</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-gray-400">
          <div>
            Page <span className="font-semibold text-gray-600">{currentPage}</span> of{' '}
            <span className="font-semibold text-gray-600">{totalPages}</span>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-amber-600 text-xs font-medium">● Unsaved changes</span>
            )}
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="text-gray-400 hover:text-gray-600 underline"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
