import { NextRequest, NextResponse } from 'next/server';
import { requirePcgAdmin } from '@/lib/pcg/auth';
import { listUsers } from '@/lib/users';
import { readConfig, writeConfig } from '@/lib/config';
import { TL_TEAMS } from '@/app/api/admin/pcg-calls/route';

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

    // Identify Team Leads
    const dbTls = pcgUsers.filter((u) => u.role === 'tl');
    const tlSet = new Set<string>();
    tlSet.add('Team Gokul');
    tlSet.add('Team Vaishnavi');
    for (const tl of dbTls) {
      tlSet.add(`Team ${tl.name}`);
    }

    // Identify RMs (agents)
    const rms = pcgUsers.filter((u) => u.role === 'agent');

    // Build assignment map
    const assignments: { rmName: string; email: string; tlName: string; userId: number }[] = [];
    for (const rm of rms) {
      const clean = rm.name.trim().toLowerCase();
      let assignedTl = customTeamMap[clean];
      if (!assignedTl) {
        if (TL_TEAMS.Gokul.some((n) => n.toLowerCase() === clean)) {
          assignedTl = 'Team Gokul';
        } else if (TL_TEAMS.Vaishnavi.some((n) => n.toLowerCase() === clean)) {
          assignedTl = 'Team Vaishnavi';
        } else {
          assignedTl = 'Unassigned';
        }
      }
      assignments.push({
        userId: rm.user_id,
        rmName: rm.name,
        email: rm.email,
        tlName: assignedTl,
      });
    }

    return NextResponse.json({
      success: true,
      teamLeads: Array.from(tlSet),
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

    if (body.rmName && body.tlName) {
      updates[body.rmName.trim().toLowerCase()] = body.tlName;
    }

    const config = await readConfig();
    const currentMap = { ...(config.pcgTeamAssignments || {}) };

    for (const [rm, tl] of Object.entries(updates)) {
      currentMap[rm.toLowerCase()] = tl;
    }

    await writeConfig({ ...config, pcgTeamAssignments: currentMap });

    return NextResponse.json({ success: true, pcgTeamAssignments: currentMap });
  } catch (err: any) {
    console.error('[pcg/admin/teams] PATCH failed:', err?.message);
    return NextResponse.json({ error: 'Failed to update team assignments.' }, { status: 500 });
  }
}
