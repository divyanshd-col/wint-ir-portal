'use client';
import React, { useState } from 'react';

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** Click cycle per column: ascending (A-Z, low to high), descending, off. */
export function useSort(initial: SortState = null): [SortState, (key: string) => void] {
  const [sort, setSort] = useState<SortState>(initial);
  const toggle = (key: string) => setSort(p => (p?.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : null));
  return [sort, toggle];
}

type Accessors<T> = Record<string, (row: T) => string | number | null | undefined>;

/** Sorts the rows currently loaded (empty values always last); returns the original order when no sort is active. */
export function sortRows<T>(rows: T[], sort: SortState, accessors: Accessors<T>): T[] {
  const get = sort && accessors[sort.key];
  if (!sort || !get) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    const xe = x == null || x === '', ye = y == null || y === '';
    if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

/** A <th> whose label sorts the table when clicked; the arrow shows the active direction. */
export function SortTh({ k, sort, onSort, style, children }: {
  k: string; sort: SortState; onSort: (k: string) => void; style?: React.CSSProperties; children: React.ReactNode;
}) {
  const on = sort?.key === k;
  const right = style?.textAlign === 'right';
  return (
    <th style={style} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button" onClick={() => onSort(k)} title="Sort"
        style={{
          all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
          justifyContent: right ? 'flex-end' : 'flex-start', width: right ? '100%' : undefined,
          color: on ? 'var(--qa-text)' : 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit',
        }}
      >
        {children}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: on ? 1 : 0.35, width: 10 }}>{on ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}
