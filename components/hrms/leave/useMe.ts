'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from './types';

/** The signed-in person's leave summary (/api/leave/me), shared by the Leave screens. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api<Me>('/api/leave/me'); if (r.ok) { setMe(r.data); setError(null); } else setError(r.error); }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  return { me, error, reload: load };
}
