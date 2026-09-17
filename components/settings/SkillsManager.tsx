'use client';

import React, { useEffect, useMemo, useState } from 'react';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface PersonaWithSkills {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  skills: string[];
}

interface SkillsManagerProps {
  showToast: (msg: string) => void;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Core':           { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-100' },
  'Analytics':      { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-100' },
  'Quality Tool':   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
  'Team Lead':      { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-100' },
  'Agent':          { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-100' },
  'Administration': { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-100' },
};

export default function SkillsManager({ showToast }: SkillsManagerProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [personas, setPersonas] = useState<PersonaWithSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('tl');
  const [viewMode, setViewMode] = useState<'persona' | 'matrix'>('persona');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [togglingKeys, setTogglingKeys] = useState<Record<string, boolean>>({});

  const fetchSkillsData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/skills');
      if (!res.ok) {
        throw new Error('Failed to load skills');
      }
      const data = await res.json();
      setSkills(data.skills || []);
      setPersonas(data.personas || []);
    } catch (err: any) {
      setError(err.message || 'Error loading permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkillsData();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    skills.forEach(s => set.add(s.category));
    return Array.from(set);
  }, [skills]);

  const activePersona = useMemo(() => {
    return personas.find(p => p.id === selectedPersonaId) || personas[0];
  }, [personas, selectedPersonaId]);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter(s => {
      const matchesSearch = !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [skills, search, selectedCategory]);

  const skillsByCategory = useMemo(() => {
    const map: Record<string, Skill[]> = {};
    for (const s of filteredSkills) {
      if (!map[s.category]) map[s.category] = [];
      map[s.category].push(s);
    }
    return map;
  }, [filteredSkills]);

  const toggleSkill = async (personaId: string, skillId: string, currentEnabled: boolean) => {
    const key = `${personaId}:${skillId}`;
    if (togglingKeys[key]) return;

    // Prevent removing skills:manage:access from admin persona
    if (personaId === 'admin' && skillId === 'skills:manage:access' && currentEnabled) {
      showToast('Cannot remove skill management permission from Administrator');
      return;
    }

    const nextEnabled = !currentEnabled;

    // Optimistic UI update
    setPersonas(prev => prev.map(p => {
      if (p.id !== personaId) return p;
      const newSkills = nextEnabled
        ? Array.from(new Set([...p.skills, skillId]))
        : p.skills.filter(id => id !== skillId);
      return { ...p, skills: newSkills };
    }));

    setTogglingKeys(prev => ({ ...prev, [key]: true }));

    try {
      const res = await fetch('/api/admin/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId,
          skillId,
          enabled: nextEnabled,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update skill');
      }

      // Sync updated skills from server
      if (data.skills) {
        setPersonas(prev => prev.map(p => {
          if (p.id !== personaId) return p;
          return { ...p, skills: data.skills };
        }));
      }

      const personaName = personas.find(p => p.id === personaId)?.name || personaId;
      const skillName = skills.find(s => s.id === skillId)?.name || skillId;
      showToast(`${skillName} ${nextEnabled ? 'enabled' : 'disabled'} for ${personaName}`);
    } catch (err: any) {
      // Rollback optimistic update
      setPersonas(prev => prev.map(p => {
        if (p.id !== personaId) return p;
        const rolledBack = currentEnabled
          ? Array.from(new Set([...p.skills, skillId]))
          : p.skills.filter(id => id !== skillId);
        return { ...p, skills: rolledBack };
      }));
      showToast(err.message || 'Update failed');
    } finally {
      setTogglingKeys(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-sm text-gray-400">
        <div className="inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
        <p>Loading configurable skills &amp; personas…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-700 space-y-3">
        <p className="font-semibold">Failed to load permissions configuration</p>
        <p>{error}</p>
        <button
          onClick={fetchSkillsData}
          className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Controls & View Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-gray-900">Skill-Based Access Control</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Turn specific feature skills ON or OFF for each user persona. Changes take effect immediately without code deployment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-gray-100 p-1 rounded-xl flex items-center text-xs font-medium">
            <button
              onClick={() => setViewMode('persona')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'persona' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Persona View
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === 'matrix' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Full Matrix View
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            type="text"
            placeholder="Search skills by name, ID, or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30"
        >
          <option value="all">All Categories ({skills.length})</option>
          {categories.map(c => (
            <option key={c} value={c}>
              {c} ({skills.filter(s => s.category === c).length})
            </option>
          ))}
        </select>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          MODE 1: PERSONA VIEW
          ══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'persona' && (
        <div className="space-y-6">
          {/* Persona selector tabs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {personas.map(p => {
              const isSelected = p.id === selectedPersonaId;
              const skillCount = p.skills.length;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedPersonaId(p.id)}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? 'bg-emerald-50/50 border-[#2d9e4f] shadow-sm'
                      : 'bg-white border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-gray-900">{p.name}</span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        isSelected ? 'bg-[#2d9e4f] text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {skillCount} / {skills.length}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">{p.description || 'Persona permissions'}</p>
                </button>
              );
            })}
          </div>

          {/* Persona Skills List Grouped by Category */}
          {activePersona && (
            <div className="space-y-6">
              {Object.entries(skillsByCategory).map(([category, catSkills]) => {
                const badge = CATEGORY_COLORS[category] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-100' };
                const enabledCount = catSkills.filter(s => activePersona.skills.includes(s.id)).length;

                return (
                  <div key={category} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 bg-gray-50/60 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}>
                          {category}
                        </span>
                        <span className="text-xs text-gray-400 font-medium">
                          {enabledCount} of {catSkills.length} active
                        </span>
                      </div>
                    </div>

                    <div className="divide-y divide-gray-50">
                      {catSkills.map(s => {
                        const isEnabled = activePersona.skills.includes(s.id);
                        const toggleKey = `${activePersona.id}:${s.id}`;
                        const isToggling = !!togglingKeys[toggleKey];

                        return (
                          <div
                            key={s.id}
                            className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-gray-50/30 transition"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">{s.name}</span>
                                <code className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                                  {s.id}
                                </code>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">{s.description}</p>
                            </div>

                            {/* ON/OFF Toggle Switch */}
                            <div className="shrink-0 flex items-center gap-3">
                              <span className={`text-xs font-semibold uppercase tracking-wider ${
                                isEnabled ? 'text-[#2d9e4f]' : 'text-gray-400'
                              }`}>
                                {isEnabled ? 'Enabled' : 'Disabled'}
                              </span>

                              <button
                                type="button"
                                role="switch"
                                aria-checked={isEnabled}
                                disabled={isToggling}
                                onClick={() => toggleSkill(activePersona.id, s.id, isEnabled)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 disabled:opacity-50 ${
                                  isEnabled ? 'bg-[#2d9e4f]' : 'bg-gray-200'
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    isEnabled ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {filteredSkills.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-400">
                  No skills matched your search filter.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          MODE 2: FULL MATRIX VIEW
          ══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'matrix' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[280px]">
                  Capability Skill
                </th>
                <th className="text-left px-3 py-3.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                {personas.map(p => (
                  <th
                    key={p.id}
                    className="text-center px-4 py-3.5 text-[11px] font-semibold text-gray-700 uppercase tracking-wider min-w-[120px]"
                  >
                    <div>{p.name}</div>
                    <div className="text-[10px] text-gray-400 lowercase font-normal">
                      {p.skills.length} on
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredSkills.map(s => {
                const badge = CATEGORY_COLORS[s.category] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-100' };

                return (
                  <tr key={s.id} className="hover:bg-gray-50/40 transition">
                    <td className="px-5 py-3.5 align-middle">
                      <div className="font-semibold text-gray-900">{s.name}</div>
                      <div className="text-xs text-gray-400 truncate max-w-sm mt-0.5">{s.description}</div>
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}>
                        {s.category}
                      </span>
                    </td>
                    {personas.map(p => {
                      const isEnabled = p.skills.includes(s.id);
                      const toggleKey = `${p.id}:${s.id}`;
                      const isToggling = !!togglingKeys[toggleKey];

                      return (
                        <td key={p.id} className="px-4 py-3.5 text-center align-middle">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isEnabled}
                            disabled={isToggling}
                            onClick={() => toggleSkill(p.id, s.id, isEnabled)}
                            title={`${isEnabled ? 'Disable' : 'Enable'} ${s.name} for ${p.name}`}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 disabled:opacity-40 ${
                              isEnabled ? 'bg-[#2d9e4f]' : 'bg-gray-200'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                isEnabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredSkills.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-400">
              No skills matched your search filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
