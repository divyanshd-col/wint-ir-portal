import type { MouseEvent } from 'react';

/** Row-level expand handler shared by every queue table: a click anywhere on the row toggles it, except on controls inside the row. */
export const rowClick = (toggle: () => void) => (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return;
  toggle();
};
