import { query, withTransaction } from '@/lib/cx/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { NextResponse } from 'next/server';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  createdAt: string;
}

export interface Persona {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface PersonaWithSkills extends Persona {
  skills: string[];
}

// ── In-Memory Cache ──────────────────────────────────────────────────────────
let cachedSkills: Skill[] | null = null;
let cachedSkillsTime = 0;

let cachedPersonaSkills: Record<string, string[]> | null = null;
let cachedPersonaSkillsTime = 0;

const CACHE_TTL_MS = 30_000; // 30 seconds

export function invalidateSkillsCache(): void {
  cachedSkills = null;
  cachedSkillsTime = 0;
  cachedPersonaSkills = null;
  cachedPersonaSkillsTime = 0;
}

// Hardcoded fallback mappings in case DB is momentarily unreachable
const DEFAULT_PERSONA_SKILLS: Record<string, string[]> = {
  admin: [
    'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
    'quality:analytics:access', 'quality:chat_eval:access', 'quality:call_eval:access',
    'tl:team_analytics:access', 'tl:member_analytics:access', 'tl:quality_chats:access',
    'tl:quality_calls:access', 'tl:reports:access', 'agent:my_analytics:access',
    'agent:my_chats:access', 'agent:my_calls:access', 'agent:reports:access',
    'tokens:view:access', 'settings:manage:access', 'users:manage:access', 'skills:manage:access',
  ],
  tl: [
    'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
    'quality:analytics:access', 'tl:team_analytics:access', 'tl:member_analytics:access',
    'tl:quality_chats:access', 'tl:quality_calls:access', 'tl:reports:access',
  ],
  quality: [
    'chat:access', 'cx_dashboard:access', 'quality:analytics:access',
    'quality:chat_eval:access', 'quality:call_eval:access',
  ],
  agent: [
    'chat:access', 'quality:analytics:access', 'agent:my_analytics:access',
    'agent:my_chats:access', 'agent:my_calls:access', 'agent:reports:access',
  ],
};

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listAllSkills(): Promise<Skill[]> {
  const now = Date.now();
  if (cachedSkills && now - cachedSkillsTime < CACHE_TTL_MS) {
    return cachedSkills;
  }
  try {
    const rows = await query<{
      id: string;
      name: string;
      description: string;
      category: string;
      created_at: string;
    }>('SELECT id, name, description, category, created_at FROM skills ORDER BY category ASC, name ASC');

    const skills: Skill[] = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      createdAt: r.created_at,
    }));
    cachedSkills = skills;
    cachedSkillsTime = now;
    return skills;
  } catch (err) {
    console.error('[skills] Failed to list skills from DB:', (err as Error)?.message);
    return cachedSkills || [];
  }
}

export async function getPersonaSkillsMap(): Promise<Record<string, string[]>> {
  const now = Date.now();
  if (cachedPersonaSkills && now - cachedPersonaSkillsTime < CACHE_TTL_MS) {
    return cachedPersonaSkills;
  }
  try {
    const rows = await query<{ persona_id: string; skill_id: string }>(
      'SELECT persona_id, skill_id FROM persona_skills'
    );
    const map: Record<string, string[]> = {
      admin: [],
      tl: [],
      quality: [],
      agent: [],
    };
    for (const row of rows) {
      if (!map[row.persona_id]) {
        map[row.persona_id] = [];
      }
      map[row.persona_id].push(row.skill_id);
    }
    cachedPersonaSkills = map;
    cachedPersonaSkillsTime = now;
    return map;
  } catch (err) {
    console.error('[skills] Failed to fetch persona_skills map:', (err as Error)?.message);
    return cachedPersonaSkills || DEFAULT_PERSONA_SKILLS;
  }
}

export async function listPersonasWithSkills(): Promise<PersonaWithSkills[]> {
  try {
    const [personas, skillMap] = await Promise.all([
      query<{
        id: string;
        name: string;
        description: string | null;
        is_system: boolean;
        created_at: string;
      }>('SELECT id, name, description, is_system, created_at FROM personas ORDER BY id ASC'),
      getPersonaSkillsMap(),
    ]);

    return personas.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isSystem: p.is_system,
      createdAt: p.created_at,
      skills: skillMap[p.id] || DEFAULT_PERSONA_SKILLS[p.id] || [],
    }));
  } catch (err) {
    console.error('[skills] Failed to list personas with skills:', (err as Error)?.message);
    return [
      { id: 'admin', name: 'Administrator', description: 'Full access', isSystem: true, createdAt: '', skills: DEFAULT_PERSONA_SKILLS.admin },
      { id: 'tl', name: 'Team Lead', description: 'Team supervision', isSystem: true, createdAt: '', skills: DEFAULT_PERSONA_SKILLS.tl },
      { id: 'quality', name: 'QA Reviewer', description: 'Quality assurance', isSystem: true, createdAt: '', skills: DEFAULT_PERSONA_SKILLS.quality },
      { id: 'agent', name: 'IR Agent', description: 'Agent operations', isSystem: true, createdAt: '', skills: DEFAULT_PERSONA_SKILLS.agent },
    ];
  }
}

export async function getSkillsForPersona(personaId?: string | null): Promise<string[]> {
  if (!personaId) return [];
  const map = await getPersonaSkillsMap();
  return map[personaId] || DEFAULT_PERSONA_SKILLS[personaId] || [];
}

export async function getEffectiveSkillsForUser(user: { id?: number; role?: string } | null | undefined): Promise<string[]> {
  if (!user?.role) return [];
  const personaSkills = await getSkillsForPersona(user.role);
  if (!user.id) return personaSkills;

  try {
    const overrides = await query<{ skill_id: string; granted: boolean }>(
      'SELECT skill_id, granted FROM user_skills WHERE user_id = $1',
      [user.id]
    );
    if (!overrides.length) return personaSkills;

    const skillSet = new Set(personaSkills);
    for (const ov of overrides) {
      if (ov.granted) {
        skillSet.add(ov.skill_id);
      } else {
        skillSet.delete(ov.skill_id);
      }
    }
    return Array.from(skillSet);
  } catch {
    return personaSkills;
  }
}

// ── Permission Checkers ──────────────────────────────────────────────────────

type UserWithSkills = {
  role?: string;
  isAdmin?: boolean;
  skills?: string[];
  userId?: number;
  email?: string | null;
  name?: string | null;
};

/**
 * Evaluates whether a user / session possesses the required skill.
 * If user has `skills` array, checks membership.
 * If user role is `admin`, grants full access by default.
 */
export function hasSkill(
  target: UserWithSkills | string[] | null | undefined,
  requiredSkill: string | string[]
): boolean {
  if (!target) return false;

  let skills: string[] = [];
  let isAdmin = false;

  if (Array.isArray(target)) {
    skills = target;
  } else {
    isAdmin = target.isAdmin === true || target.role === 'admin';
    skills = target.skills || (target.role ? DEFAULT_PERSONA_SKILLS[target.role] || [] : []);
  }

  // Admin persona has superuser bypass if skills not populated
  if (isAdmin && (!skills.length || skills.includes('settings:manage:access'))) {
    return true;
  }

  if (Array.isArray(requiredSkill)) {
    return requiredSkill.some(s => skills.includes(s));
  }
  return skills.includes(requiredSkill);
}

export function hasAllSkills(
  target: UserWithSkills | string[] | null | undefined,
  requiredSkills: string[]
): boolean {
  if (!target) return false;
  return requiredSkills.every(s => hasSkill(target, s));
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function togglePersonaSkill(
  personaId: string,
  skillId: string,
  enabled: boolean,
  actorEmail: string
): Promise<string[]> {
  await withTransaction(async (tx) => {
    if (enabled) {
      await tx.query(
        `INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (persona_id, skill_id) DO NOTHING`,
        [personaId, skillId, actorEmail]
      );
    } else {
      await tx.query(
        `DELETE FROM persona_skills WHERE persona_id = $1 AND skill_id = $2`,
        [personaId, skillId]
      );
    }

    // Append to identity_audit
    await tx.query(
      `INSERT INTO identity_audit (actor_email, action, target_email, detail)
       VALUES ($1, 'skill_change', NULL, $2)`,
      [actorEmail, JSON.stringify({ personaId, skillId, enabled })]
    );
  });

  invalidateSkillsCache();
  return getSkillsForPersona(personaId);
}

// ── API Route Guard ──────────────────────────────────────────────────────────

export async function requireSkill(skill: string | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }), session: null, user: null };
  }

  const user = session.user as UserWithSkills;
  const userSkills = user.skills || (await getSkillsForPersona(user.role));

  const authorized = hasSkill({ ...user, skills: userSkills }, skill);
  if (!authorized) {
    const required = Array.isArray(skill) ? skill.join(' or ') : skill;
    return {
      error: NextResponse.json(
        { error: `Forbidden. Missing required skill: ${required}` },
        { status: 403 }
      ),
      session: null,
      user: null,
    };
  }

  return { error: null, session, user: { ...user, skills: userSkills } };
}
