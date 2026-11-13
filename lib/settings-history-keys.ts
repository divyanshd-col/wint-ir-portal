/**
 * Which admin settings keep a change history, and how a value is compared and restored. Pure and client-safe.
 * The live values stay in the settings store (Redis); every change to a tracked one is also written to Postgres
 * (lib/settings-history.ts) with who changed it and the text before and after.
 */
import { MAX_PROMPT_CHARS, type Workspace } from './prompt-overrides';
import { parseEmailRubric } from './email/context-builder';
import { DEFAULT_QUALITY_THRESHOLDS, parseQualityThresholds } from './quality-thresholds';
import { parseDisputeOwner } from './dispute-owner';

export const TRACKED_SETTINGS = {
  systemPrompt:            { label: 'Chat Assistant prompt',          workspace: 'cx' },
  iqsScoringPrompt:        { label: 'Chat IQS Scoring prompt',        workspace: 'cx' },
  callGatesPrompt:         { label: 'Call: Compliance Gates prompt',  workspace: 'cx' },
  callIqsPrompt:           { label: 'Call: IQS Scoring prompt',       workspace: 'cx' },
  emailPromptIntro:        { label: 'Email: role and tasks',          workspace: 'cx' },
  emailPromptCompliance:   { label: 'Email: compliance rules',        workspace: 'cx' },
  emailRubric:             { label: 'Email scoring rubric',           workspace: 'cx' },
  qualityThresholds:       { label: 'Quality thresholds',             workspace: 'cx' },
  disputeOwner:            { label: 'Dispute owner (QA or TL)',       workspace: 'cx' },
  pcgQualityPrompt:        { label: 'PCG: Quality prompt',            workspace: 'pcg' },
  pcgClassificationPrompt: { label: 'PCG: Classification prompt',     workspace: 'pcg' },
} as const satisfies Record<string, { label: string; workspace: Workspace }>;

export type TrackedKey = keyof typeof TRACKED_SETTINGS;
/** null means "the built-in default" (nothing saved). */
export type SettingValue = string | Record<string, unknown> | null;
export interface SettingChange { key: TrackedKey; oldValue: SettingValue; newValue: SettingValue }

export const isTrackedKey = (k: string): k is TrackedKey => Object.prototype.hasOwnProperty.call(TRACKED_SETTINGS, k);
export const trackedKeysFor = (workspace: Workspace): TrackedKey[] =>
  (Object.keys(TRACKED_SETTINGS) as TrackedKey[]).filter(k => TRACKED_SETTINGS[k].workspace === workspace);

/** Key order must not matter when comparing two objects. */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}

/** A stored config value as history sees it: blank text, an empty rubric and default thresholds all count as "default" (null). */
export function normalizeSettingValue(key: TrackedKey, raw: unknown): SettingValue {
  if (key === 'emailRubric') return raw && typeof raw === 'object' && Object.keys(raw as object).length ? (raw as Record<string, unknown>) : null;
  if (key === 'disputeOwner') return raw === 'tl' ? 'tl' : null; // 'qa' and nothing saved are the same: the default
  if (key === 'qualityThresholds') {
    if (!raw || typeof raw !== 'object') return null;
    return canon(raw) === canon(DEFAULT_QUALITY_THRESHOLDS) ? null : (raw as Record<string, unknown>);
  }
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

/** The tracked settings that differ between two config objects. */
export function diffTrackedSettings(oldCfg: object, newCfg: object): SettingChange[] {
  const out: SettingChange[] = [];
  for (const key of Object.keys(TRACKED_SETTINGS) as TrackedKey[]) {
    const oldValue = normalizeSettingValue(key, (oldCfg as Record<string, unknown>)[key]);
    const newValue = normalizeSettingValue(key, (newCfg as Record<string, unknown>)[key]);
    if (canon(oldValue) !== canon(newValue)) out.push({ key, oldValue, newValue });
  }
  return out;
}

/** The config change that puts a history value back. Values are validated again, as on a normal save. */
export function restoreToConfigPatch(key: TrackedKey, value: SettingValue): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (key === 'emailRubric') {
    if (value === null) return { ok: true, patch: { emailRubric: {} } };
    const r = parseEmailRubric(value);
    return r.ok ? { ok: true, patch: { emailRubric: r.value } } : { ok: false, error: r.error };
  }
  if (key === 'disputeOwner') {
    const r = parseDisputeOwner(value ?? 'qa');
    return r.ok ? { ok: true, patch: { disputeOwner: r.value } } : { ok: false, error: r.error };
  }
  if (key === 'qualityThresholds') {
    if (value === null) return { ok: true, patch: { qualityThresholds: undefined } };
    const r = parseQualityThresholds(value);
    return r.ok ? { ok: true, patch: { qualityThresholds: r.value } } : { ok: false, error: r.error };
  }
  if (value === null) return { ok: true, patch: { [key]: '' } };
  if (typeof value !== 'string') return { ok: false, error: 'This version is not text' };
  if (value.length > MAX_PROMPT_CHARS) return { ok: false, error: 'This version is too long' };
  return { ok: true, patch: { [key]: value } };
}
