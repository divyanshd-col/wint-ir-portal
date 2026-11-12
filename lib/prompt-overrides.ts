/**
 * Admin-editable prompt text (Settings → Prompts) for call, email and PCG scoring.
 * Each prompt belongs to one workspace; a CX admin never sees or saves PCG prompts, and the other way round.
 * Pure and client-safe: no config or DB access here.
 */
export type Workspace = 'cx' | 'pcg';

/** Config field → the workspace that owns it. An empty or missing value means "use the built-in default". */
export const PROMPT_FIELDS = {
  callGatesPrompt: 'cx',
  callIqsPrompt: 'cx',
  emailPromptIntro: 'cx',
  emailPromptCompliance: 'cx',
  pcgQualityPrompt: 'pcg',
  pcgClassificationPrompt: 'pcg',
} as const satisfies Record<string, Workspace>;

export type PromptField = keyof typeof PROMPT_FIELDS;

export const MAX_PROMPT_CHARS = 60_000;

/** The saved text if there is any, otherwise the built-in default. */
export function promptOrDefault(saved: string | null | undefined, fallback: string): string {
  return saved && saved.trim() ? saved : fallback;
}

export interface PromptUser { isSuperAdmin?: boolean; platformDomain?: string | null }

/** Which workspaces this user may manage (super admins and 'both' users: both). */
export function workspaceAccess(user: PromptUser | null | undefined): { cx: boolean; pcg: boolean } {
  const all = Boolean(user?.isSuperAdmin) || user?.platformDomain === 'both';
  return { cx: all || user?.platformDomain === 'cx' || !user?.platformDomain, pcg: all || user?.platformDomain === 'pcg' };
}

/** The prompt fields shown in the workspace the user is currently in (and allowed to manage). */
export function visiblePromptFields(activeDomain: Workspace, user: PromptUser | null | undefined): PromptField[] {
  if (!workspaceAccess(user)[activeDomain]) return [];
  return (Object.keys(PROMPT_FIELDS) as PromptField[]).filter(f => PROMPT_FIELDS[f] === activeDomain);
}

/** Validates the prompt fields in a save request: known fields only, strings within the size limit, allowed for this user.
 *  Returns only the prompt fields that were present. */
export function parsePromptFields(body: unknown, user: PromptUser | null | undefined): { ok: true; value: Partial<Record<PromptField, string>> } | { ok: false; status: number; error: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  const access = workspaceAccess(user);
  const value: Partial<Record<PromptField, string>> = {};
  for (const field of Object.keys(PROMPT_FIELDS) as PromptField[]) {
    if (o[field] === undefined) continue;
    if (!access[PROMPT_FIELDS[field]]) return { ok: false, status: 403, error: `Not allowed to edit ${PROMPT_FIELDS[field].toUpperCase()} prompts` };
    const v = o[field];
    if (typeof v !== 'string') return { ok: false, status: 400, error: `${field} must be text` };
    if (v.length > MAX_PROMPT_CHARS) return { ok: false, status: 400, error: `${field} is too long (max ${MAX_PROMPT_CHARS.toLocaleString()} characters)` };
    value[field] = v;
  }
  return { ok: true, value };
}

/** Where the locked JSON output format starts in a prompt. Everything before it is editable wording; this part is not. */
const OUTPUT_START = /^(?:## OUTPUT FORMAT|OUTPUT:|=== OUTPUT SCHEMA).*$/m;

export function splitPrompt(text: string): { editable: string; locked: string } {
  const i = text.search(OUTPUT_START);
  return i < 0 ? { editable: text, locked: '' } : { editable: text.slice(0, i).trimEnd(), locked: text.slice(i) };
}

export const joinPrompt = (editable: string, locked: string): string => (locked ? `${editable.trimEnd()}\n\n${locked}` : editable);

/** True when a saved prompt still ends with the default's output-format block, unchanged. Blank (= use default) is fine. */
export function outputFormatIntact(saved: string, defaultText: string): boolean {
  const locked = splitPrompt(defaultText).locked.trim();
  return !saved.trim() || !locked || splitPrompt(saved).locked.trim() === locked;
}
