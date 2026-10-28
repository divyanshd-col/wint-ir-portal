import { readConfig } from '@/lib/config';

/** The topics (dispositions) that at least one QA is responsible for: the list a TL can pick from when a chat has none. */
export async function getDefinedDispositions(): Promise<string[]> {
  const config = await readConfig();
  const set = new Set<string>();
  for (const u of (config.users ?? []) as any[]) {
    if (u.role === 'quality') for (const d of (u.assignedDispositions ?? [])) set.add(d);
  }
  for (const e of (config.qaDispositionMap ?? []) as any[]) for (const d of (e.dispositions ?? [])) set.add(d);
  return [...set].sort((a, b) => a.localeCompare(b));
}
