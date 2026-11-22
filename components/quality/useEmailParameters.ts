'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_EMAIL_PARAMETERS, type EvaluationParameterConfig } from '@/lib/email/context-builder';

let cached: { at: number; params: EvaluationParameterConfig[] } | null = null;
const TTL_MS = 60_000;

/** The email QA parameters as set in Settings → Scoring Rubric. Starts with the defaults so the page renders at once,
 *  then swaps in the saved rubric. Remembered for a minute, so a page full of rows asks the server once. */
export function useEmailParameters(): EvaluationParameterConfig[] {
  const [params, setParams] = useState<EvaluationParameterConfig[]>(cached?.params ?? DEFAULT_EMAIL_PARAMETERS);
  useEffect(() => {
    if (cached && Date.now() - cached.at < TTL_MS) return;
    let live = true;
    fetch('/api/email-rubric')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live || !Array.isArray(d?.parameters)) return;
        cached = { at: Date.now(), params: d.parameters };
        setParams(d.parameters);
      })
      .catch(() => { /* keep the defaults */ });
    return () => { live = false; };
  }, []);
  return params;
}
