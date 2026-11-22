import { query } from '@/lib/cx/db';
import type { SettingChange, SettingValue } from './settings-history-keys';

/** Change history for the admin settings in settings-history-keys.ts: one row per change, with the value before and after. */
export const SETTINGS_HISTORY_DDL = `
  CREATE TABLE IF NOT EXISTS settings_history (
    id          BIGSERIAL PRIMARY KEY,
    setting_key TEXT NOT NULL,
    action      TEXT NOT NULL DEFAULT 'save',
    old_value   JSONB,
    new_value   JSONB,
    changed_by  TEXT NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
export const SETTINGS_HISTORY_INDEX = `CREATE INDEX IF NOT EXISTS idx_settings_history_key_time ON settings_history (setting_key, changed_at DESC)`;

// Self-heals if migration 036 has not been applied (same approach as the OAuth tables).
let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await query(SETTINGS_HISTORY_DDL);
  await query(SETTINGS_HISTORY_INDEX);
  ensured = true;
}

export type HistoryAction = 'save' | 'restore';

export async function recordSettingChanges(changes: SettingChange[], actor: string, action: HistoryAction): Promise<void> {
  if (!changes.length) return;
  await ensureTable();
  const json = (v: SettingValue) => (v === null ? null : JSON.stringify(v));
  for (const c of changes) {
    await query(
      `INSERT INTO settings_history (setting_key, action, old_value, new_value, changed_by) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [c.key, action, json(c.oldValue), json(c.newValue), actor],
    );
  }
}

export interface HistoryListRow {
  id: number; key: string; action: HistoryAction; changedBy: string; changedAt: string;
  oldChars: number | null; newChars: number | null;   // null = the built-in default
}

export async function listSettingsHistory(keys: string[], limit = 100): Promise<HistoryListRow[]> {
  if (!keys.length) return [];
  await ensureTable();
  const rows = await query<{ id: string; setting_key: string; action: HistoryAction; changed_by: string; changed_at: Date; old_chars: number | null; new_chars: number | null }>(
    `SELECT id, setting_key, action, changed_by, changed_at,
            CASE WHEN old_value IS NULL THEN NULL ELSE length(old_value #>> '{}') END AS old_chars,
            CASE WHEN new_value IS NULL THEN NULL ELSE length(new_value #>> '{}') END AS new_chars
       FROM settings_history WHERE setting_key = ANY($1::text[])
      ORDER BY changed_at DESC, id DESC LIMIT $2`,
    [keys, limit],
  );
  return rows.map(r => ({
    id: Number(r.id), key: r.setting_key, action: r.action, changedBy: r.changed_by, changedAt: new Date(r.changed_at).toISOString(),
    oldChars: r.old_chars, newChars: r.new_chars,
  }));
}

export interface HistoryEntry extends HistoryListRow { oldValue: SettingValue; newValue: SettingValue }

export async function getSettingsHistoryEntry(id: number): Promise<HistoryEntry | null> {
  await ensureTable();
  const rows = await query<{ id: string; setting_key: string; action: HistoryAction; changed_by: string; changed_at: Date; old_value: SettingValue; new_value: SettingValue }>(
    `SELECT id, setting_key, action, changed_by, changed_at, old_value, new_value FROM settings_history WHERE id = $1`, [id],
  );
  const r = rows[0];
  if (!r) return null;
  const chars = (v: SettingValue) => (v === null ? null : (typeof v === 'string' ? v : JSON.stringify(v)).length);
  return {
    id: Number(r.id), key: r.setting_key, action: r.action, changedBy: r.changed_by, changedAt: new Date(r.changed_at).toISOString(),
    oldChars: chars(r.old_value), newChars: chars(r.new_value), oldValue: r.old_value, newValue: r.new_value,
  };
}
