'use client';

/** Sticky search box for the top of a long dropdown (same pattern as the PCG agent picker). Renders nothing for short
 *  lists, so callers can drop it into any menu. Pair with `matchesSearch` to filter the items. */
export default function DropdownSearch({ value, onChange, count, placeholder = 'Search…', minItems = 8 }: {
  value: string;
  onChange: (v: string) => void;
  /** Number of items in the list; the box only shows when there are more than `minItems`. */
  count: number;
  placeholder?: string;
  minItems?: number;
}) {
  if (count <= minItems) return null;
  return (
    <div className="dd-search" onClick={e => e.stopPropagation()}>
      <input
        type="search" autoFocus value={value} placeholder={placeholder} aria-label={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }}
      />
    </div>
  );
}

export const matchesSearch = (q: string, text: string) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
