import { NextRequest, NextResponse } from 'next/server';
import {
  listAllSkills,
  listPersonasWithSkills,
  togglePersonaSkill,
  requireSkill,
} from '@/lib/skills';

export async function GET() {
  const auth = await requireSkill(['skills:manage:access', 'settings:manage:access']);
  if (auth.error) return auth.error;

  try {
    const [skills, personas] = await Promise.all([
      listAllSkills(),
      listPersonasWithSkills(),
    ]);

    return NextResponse.json({ skills, personas });
  } catch (err) {
    console.error('[skills API] GET failed:', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to load skills and personas' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSkill(['skills:manage:access', 'settings:manage:access']);
  if (auth.error) return auth.error;

  const actorEmail = auth.user?.email || 'admin@wintwealth.com';

  const body = await req.json().catch(() => ({}));
  const { personaId, skillId, enabled } = body;

  if (!personaId || typeof personaId !== 'string') {
    return NextResponse.json({ error: 'personaId is required' }, { status: 400 });
  }
  if (!skillId || typeof skillId !== 'string') {
    return NextResponse.json({ error: 'skillId is required' }, { status: 400 });
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  // Prevent bricking: Admin cannot remove skills:manage:access from the admin persona
  if (personaId === 'admin' && skillId === 'skills:manage:access' && !enabled) {
    return NextResponse.json({ error: 'Cannot remove skill management permission from Administrator' }, { status: 400 });
  }

  try {
    const updatedSkills = await togglePersonaSkill(personaId, skillId, enabled, actorEmail);
    return NextResponse.json({
      success: true,
      personaId,
      skillId,
      enabled,
      skills: updatedSkills,
    });
  } catch (err) {
    console.error('[skills API] PATCH failed:', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to update persona skill' }, { status: 500 });
  }
}
