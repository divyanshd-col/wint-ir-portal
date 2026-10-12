import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { NextResponse } from 'next/server';
import { hasSkill, getSkillsForPersona } from '@/lib/skills';

// Map legacy role requirements to their skill equivalents for backward-compatible route guarding
const ROLE_TO_SKILLS: Record<string, string[]> = {
  admin: ['settings:manage:access', 'skills:manage:access', 'users:manage:access'],
  quality: ['quality:chat_eval:access', 'quality:call_eval:access', 'quality:analytics:access'],
  tl: ['tl:team_analytics:access', 'tl:member_analytics:access', 'tl:quality_chats:access', 'tl:quality_calls:access', 'tl:reports:access'],
  agent: ['agent:my_analytics:access', 'agent:my_chats:access', 'agent:my_calls:access', 'agent:reports:access', 'chat:access'],
};

export async function requireRole(allowedRoles: string[] | string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const user = session.user as any;
  const role = user?.role;
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  // Admin superuser bypass
  if (user?.isAdmin || role === 'admin') {
    return { session, response: null };
  }

  // Evaluate based on active assigned skills
  const skills: string[] = user.skills || (await getSkillsForPersona(role));

  const hasDirectRole = role && roles.includes(role);
  const relevantSkills = roles.flatMap(r => ROLE_TO_SKILLS[r] || []);
  const hasMatchingSkill = relevantSkills.some(s => skills.includes(s));

  if (!hasDirectRole && !hasMatchingSkill) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { session, response: null };
}

export async function requireSkillCheck(skill: string | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const user = session.user as any;
  const skills: string[] = user.skills || (await getSkillsForPersona(user.role));

  if (!hasSkill({ ...user, skills }, skill)) {
    const reqStr = Array.isArray(skill) ? skill.join(' or ') : skill;
    return {
      session: null,
      response: NextResponse.json({ error: `Forbidden. Missing skill: ${reqStr}` }, { status: 403 }),
    };
  }

  return { session, response: null };
}
