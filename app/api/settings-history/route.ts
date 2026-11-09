import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig, writeConfig, type PortalConfig } from '@/lib/config';
import { workspaceAccess, type Workspace } from '@/lib/prompt-overrides';
import { TRACKED_SETTINGS, isTrackedKey, trackedKeysFor, diffTrackedSettings, restoreToConfigPatch } from '@/lib/settings-history-keys';
import { listSettingsHistory, getSettingsHistoryEntry, recordSettingChanges } from '@/lib/settings-history';

/** Change history for admin settings. Workspace-scoped like the settings themselves: CX admins see CX settings, PCG admins PCG.
 *  GET ?workspace=cx|pcg  -> the recent changes        GET ?id=N -> one change with the full before / after
 *  POST {id, side:'old'|'new'} -> put that version back (recorded as a 'restore' in the history) */

async function adminUser() {
  const session = await getServerSession(authOptions);
  return session?.user?.isAdmin ? session.user : null;
}

export async function GET(req: NextRequest) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const access = workspaceAccess(user);
  const { searchParams } = new URL(req.url);

  const id = searchParams.get('id');
  if (id !== null) {
    const entry = Number.isInteger(Number(id)) ? await getSettingsHistoryEntry(Number(id)) : null;
    if (!entry || !isTrackedKey(entry.key)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!access[TRACKED_SETTINGS[entry.key].workspace]) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ entry }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const workspace = searchParams.get('workspace');
  if (workspace !== 'cx' && workspace !== 'pcg') return NextResponse.json({ error: 'workspace must be cx or pcg' }, { status: 400 });
  if (!access[workspace as Workspace]) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await listSettingsHistory(trackedKeysFor(workspace as Workspace));
  return NextResponse.json({ rows: rows.map(r => ({ ...r, label: isTrackedKey(r.key) ? TRACKED_SETTINGS[r.key].label : r.key })) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!Number.isInteger(body.id) || (body.side !== 'old' && body.side !== 'new')) return NextResponse.json({ error: 'id and side (old | new) are required' }, { status: 400 });

  const entry = await getSettingsHistoryEntry(body.id);
  if (!entry || !isTrackedKey(entry.key)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!workspaceAccess(user)[TRACKED_SETTINGS[entry.key].workspace]) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const restored = restoreToConfigPatch(entry.key, body.side === 'old' ? entry.oldValue : entry.newValue);
  if (!restored.ok) return NextResponse.json({ error: restored.error }, { status: 400 });

  const config = await readConfig();
  const updated: PortalConfig = { ...config, ...restored.patch };
  const changes = diffTrackedSettings(config, updated);
  if (!changes.length) return NextResponse.json({ ok: true, changed: false });

  try {
    await recordSettingChanges(changes, user.email || user.name || 'unknown', 'restore');
  } catch (err) {
    console.error('[settings-history] could not record restore:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not record the change history, so nothing was restored. Please try again.' }, { status: 500 });
  }
  await writeConfig(updated);
  return NextResponse.json({ ok: true, changed: true });
}
