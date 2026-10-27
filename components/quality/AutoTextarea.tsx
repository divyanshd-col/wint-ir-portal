'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** A <textarea> that grows to fit its text, so a long reasoning never becomes a scroll box inside a scrolling pane. */
export default function AutoTextarea({ style, onInput, rows = 1, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, []);
  useLayoutEffect(fit, [fit, rest.value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  return <textarea ref={ref} rows={rows} onInput={e => { fit(); onInput?.(e); }} style={{ ...style, overflow: 'hidden', resize: 'none' }} {...rest} />;
}
