'use client';

import React from 'react';
import { isFiltered, NO_FILTER, type RosterFilter, type RosterView } from '@/lib/roster';
import { offShort, roleLabel, type Pattern, type Person } from '@/components/roster/ui';
import { Button, Ico, cx } from '../ui';

/** Team lead options built from who is on screen, with how many people each has. */
export function teamOptions(people: Person[]) {
  const byTl = new Map<number, { name: string; n: number }>();
  let none = 0;
  for (const p of people) {
    if (p.tlUserId === null) { none++; continue; }
    const cur = byTl.get(p.tlUserId);
    if (cur) cur.n++; else byTl.set(p.tlUserId, { name: p.tlName ?? 'Unknown', n: 1 });
  }
  const list = [...byTl.entries()].map(([id, v]) => ({ value: String(id), label: `${v.name}’s team`, n: v.n })).sort((a, b) => a.label.localeCompare(b.label));
  if (none) list.push({ value: 'none', label: 'No team lead assigned', n: none });
  return list;
}
/** A saved team that no longer exists (a team lead was removed) must not hide everybody. */
export function validFilter(f: RosterFilter, people: Person[]): RosterFilter {
  return f.team === 'all' || teamOptions(people).some(o => o.value === f.team) ? f : { ...f, team: 'all' };
}
const statusWhen: Record<RosterView, string> = { day: 'on this day', week: 'this week', month: 'this month' };

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select aria-label={label} title={label} value={value} onChange={e => onChange(e.target.value)} className={cx('input', 'sm', 'fsel', value !== 'all' && 'on')}>{children}</select>;
}

export default function RosterFilters({ people, patterns, view, leaveReady, value, onChange, shown }: {
  people: Person[]; patterns: Pattern[]; view: RosterView; leaveReady: boolean; value: RosterFilter; onChange: (f: RosterFilter) => void; shown: number;
}) {
  const set = (k: keyof RosterFilter) => (v: string) => onChange({ ...value, [k]: v });
  const teams = teamOptions(people);
  const roles = [...new Set(people.map(p => p.role))].sort();
  const active = isFiltered(value);
  const hasUnset = people.some(p => p.pattern === null);
  return (
    <div className="row" style={{ gap: 8, marginBottom: 12 }} role="search" aria-label="Filter the roster">
      <span className="fsearch">
        <Ico n="search" size={15} />
        <input type="text" aria-label="Search people" placeholder="Search people…" value={value.q} maxLength={60} autoComplete="off" spellCheck={false}
          className={cx('input', 'sm', value.q.trim() && 'on')} onChange={e => set('q')(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') set('q')(''); }} />
        {value.q && <button type="button" className="fx" aria-label="Clear search" onClick={() => set('q')('')}><Ico n="x" size={14} /></button>}
      </span>
      {teams.length > 1 && <Select label="Team" value={value.team} onChange={set('team')}><option value="all">All teams</option>{teams.map(t => <option key={t.value} value={t.value}>{t.label} · {t.n}</option>)}</Select>}
      <Select label="Roster type" value={value.type} onChange={set('type')}><option value="all">All types</option>{patterns.map(p => <option key={p.id} value={String(p.id)}>{p.rotates === false ? 'Fixed' : `Type ${p.id}`} · {offShort(p)}</option>)}{hasUnset && <option value="unset">Not set</option>}</Select>
      {roles.length > 1 && <Select label="Role" value={value.role} onChange={set('role')}><option value="all">All roles</option>{roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select>}
      <Select label={`Status ${statusWhen[view]}`} value={value.status} onChange={set('status')}>
        <option value="all">Any status</option><option value="working">Working</option><option value="off">Week-off</option><option value="extra">Extra day worked</option>
        {leaveReady && <><option value="leave">Leave or LOP</option><option value="hol">Holiday</option></>}
      </Select>
      <span className="spacer" />
      <span className="sm12 mut" role="status" aria-live="polite">{active ? `Showing ${shown} of ${people.length}` : `${people.length} ${people.length === 1 ? 'person' : 'people'}`}</span>
      {active && <Button kind="secondary" size="sm" onClick={() => onChange(NO_FILTER)}>Clear filters</Button>}
    </div>
  );
}
