'use client';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface Opt { value: string; label: string; disabled?: boolean }

const textOf = (n: React.ReactNode): string =>
  React.Children.toArray(n).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : React.isValidElement(c) ? textOf((c as React.ReactElement<any>).props.children) : '')).join('');

function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, c => {
    if (!React.isValidElement(c)) return;
    const el = c as React.ReactElement<any>;
    if (el.type === React.Fragment || el.type === 'optgroup') collect(el.props.children, out);
    else if (el.type === 'option') {
      const label = textOf(el.props.children);
      out.push({ value: String(el.props.value ?? label), label, disabled: el.props.disabled });
    }
  });
  return out;
}

export interface UISelectProps {
  value: string;
  onChange?: (e: any) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
}

/**
 * Drop-in for <select>: same <option> children and value / onChange(e.target.value), but the open list is a themed popover
 * (native selects open an OS menu that ignores light/dark and our tokens). Anything other than the first option (the "all" choice) renders as an active filter chip.
 */
export default function UISelect({ value, onChange, children, style, disabled, title, ...rest }: UISelectProps) {
  const options = useMemo(() => collect(children), [children]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === String(value ?? ''));
  const active = options.length > 0 && String(value ?? '') !== options[0].value; // the first option is the "no filter" choice

  const close = useCallback(() => setOpen(false), []);
  const choose = (o: Opt) => { if (o.disabled) return; onChange?.({ target: { value: o.value } }); setOpen(false); btn.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setPos(below < 260 && r.top > below
      ? { left: r.left, bottom: window.innerHeight - r.top + 4, minWidth: r.width }
      : { left: r.left, top: r.bottom + 4, minWidth: r.width });
    setHi(Math.max(0, options.findIndex(o => o.value === String(value ?? ''))));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const scroll = (e: Event) => { if (!menu.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); };
  }, [open, close]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); } return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(options.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[hi]) choose(options[hi]); }
    else if (e.key === 'Tab') close();
  };

  const width = style?.width, minWidth = style?.minWidth, maxWidth = style?.maxWidth;
  return (
    <span style={{ position: 'relative', display: 'inline-block', width, minWidth, maxWidth }}>
      <button
        ref={btn} type="button" disabled={disabled} title={title} aria-label={rest['aria-label']}
        aria-haspopup="listbox" aria-expanded={open}
        className={`ui-select-btn${active ? ' on' : ''}`}
        onClick={() => setOpen(o => !o)} onKeyDown={onKey}
      >
        <span className="ui-select-label">{current?.label ?? options[0]?.label ?? ''}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && pos && (
        <div ref={menu} role="listbox" className="ui-select-menu" style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: Math.max(pos.minWidth, 160) }}>
          {options.map((o, i) => (
            <div
              key={`${o.value}:${i}`} role="option" aria-selected={o.value === String(value ?? '')} aria-disabled={o.disabled}
              className={`ui-select-item${i === hi ? ' hi' : ''}${o.disabled ? ' off' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(o)}
            >
              <span className="ui-select-check">{o.value === String(value ?? '') ? '✓' : ''}</span>
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
