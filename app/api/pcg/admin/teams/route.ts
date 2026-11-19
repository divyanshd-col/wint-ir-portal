import { NextRequest, NextResponse } from 'next/server';
import { requirePcgAdmin } from '@/lib/pcg/auth';
import { listUsers } from '@/lib/users';
import { readConfig, writeConfig } from '@/lib/config';
import { canonicalizePcgRmName } from '@/lib/pcg/canonical-names';

export async function GET(req: NextRequest) {
  const { session, response } = await requirePcgAdmin();
  if (response) return response;

  try {
    const config = await readConfig().catch(() => null);
    const customTeamMap = config?.pcgTeamAssignments || {};
    const allUsers = await listUsers();

    // Get all PCG users
    const pcgUsers = allUsers.filter(
      (u) => u.platform_domain === 'pcg' || u.platform_domain === 'both' || u.is_super_admin
    );

    // Dynamic Team Leads: users in DB with role === 'tl'
    const teamLeads = pcgUsers
      .filter((u) => u.role === 'tl' && u.status !== 'disabled')
      .map((u) => u.name);

    // Identify RMs (agents)
    const rms = pcgUsers.filter((u) => u.role === 'agent');

    // Build assignment map from portal configurations only
    const assignments: { rmName: string; email: string; tlName: string; userId: number }[] = [];
    for (const rm of rms) {
      const clean = rm.name.trim().toLowerCase();
      const assignedTl = customTeamMap[clean] || '';
      assignments.push({
        userId: rm.user_id,
        rmName: rm.name,
        email: rm.email,
        tlName: assignedTl,
      });
    }

    return NextResponse.json({
      success: true,
      teamLeads,
      assignments,
    });
  } catch (err: any) {
    console.error('[pcg/admin/teams] GET failed:', err?.message);
    return NextResponse.json({ error: 'Failed to load team structures.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { session, response } = await requirePcgAdmin();
  if (response) return response;

  try {
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, string> = body.assignments || {};

    if (body.rmName && body.tlName !== undefined) {
      updates[body.rmName.trim().toLowerCase()] = body.tlName;
    }

    const config = await readConfig();
    const currentMap = { ...(config.pcgTeamAssignments || {}) };

    for (const [rm, tl] of Object.entries(updates)) {
      const key = rm.toLowerCase().trim();
      const canonicalKey = canonicalizePcgRmName(rm).toLowerCase().trim();
      if (!tl || tl === 'Unassigned') {
        delete currentMap[key];
        delete currentMap[canonicalKey];
      } else {
        currentMap[key] = tl;
        currentMap[canonicalKey] = tl;
      }

      // Sync to pcg_rm_directory in Postgres
      try {
        const { query } = await import('@/lib/cx/db');
        const tlDisplay = (!tl || tl === 'Unassigned') ? 'PCG Team' : (tl.startsWith('Team ') ? tl : `Team ${tl}`);
        await query(
          `UPDATE pcg_rm_directory 
           SET tl_name = $1, updated_at = NOW() 
           WHERE LOWER(TRIM(rm_name)) = $2 OR LOWER(TRIM(rm_name)) = $3`,
          [tlDisplay, key, canonicalKey]
        );
      } catch (dbErr) {
        console.warn('[pcg/admin/teams] could not sync pcg_rm_directory table:', dbErr);
      }
    }

    await writeConfig({ ...config, pcgTeamAssignments: currentMap });

    return NextResponse.json({ success: true, pcgTeamAssignments: currentMap });
  } catch (err: any) {
    console.error('[pcg/admin/teams] PATCH failed:', err?.message);
    return NextResponse.json({ error: 'Failed to update team assignments.' }, { status: 500 });
  }
}
