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

/** Topic names compare ignoring case and surrounding spaces ("OTHERS" is "Others"). */
export const topicKey = (t: string | null | undefined) => String(t ?? '').trim().toLowerCase();

/** The defined topic matching `t`, or undefined when `t` is empty or no QA owns it. */
export function findDefinedTopic(defined: string[], t: string | null | undefined): string | undefined {
  const k = topicKey(t);
  return k ? defined.find(d => topicKey(d) === k) : undefined;
}
