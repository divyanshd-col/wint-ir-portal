/**
 * The whole app is rendered at html { zoom: var(--ui-zoom) } (app/globals.css, one setting for the overall UI size).
 * With zoom, getBoundingClientRect() and window.inner* report on-screen pixels, but left/top/width written back as CSS are
 * scaled again. Divide measured values by this before using them as CSS pixels (dropdown and tooltip placement).
 */
export const uiZoom = (): number => (typeof document === 'undefined' ? 1 : parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
