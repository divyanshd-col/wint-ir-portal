import { NextRequest, NextResponse } from 'next/server';
import { requirePcgAdmin } from '@/lib/pcg/auth';
import type { UserRole } from '@/next-auth';
import {
  listUsers,
  createInvite,
  createSignupToken,
  changeRole,
  changeStatus,
  updateUserProfile,
  getUserById,
  isUniqueViolation,
  audit,
  updateUserDomain,
  type UserStatus,
} from '@/lib/users';
import { sendInviteEmail, mailerConfigured } from '@/lib/mailer';
import { isAllowedEmail, normalizeEmail, normalizeName } from '@/lib/identity';
import { readConfig, writeConfig } from '@/lib/config';
const VALID_ROLES: UserRole[] = ['agent', 'admin', 'quality', 'tl'];
const DORMANT_DAYS = 60;

function resolveTlForRm(rmName: string, customMap?: Record<string, string>): string {
  const clean = rmName.trim().toLowerCase();
  if (customMap && customMap[clean]) {
    return customMap[clean];
  }
  return '';
}

// GET — List all PCG team users
export async function GET(req: NextRequest) {
  const { session, response } = await requirePcgAdmin();
  if (response) return response;

  const now = Date.now();
  try {
    const config = await readConfig().catch(() => null);
    const customTeamMap = config?.pcgTeamAssignments || {};
    const allUsers = await listUsers();

    // Filter to users who belong to PCG or are Super Admin / Both
    const pcgUsers = allUsers.filter(
      (u) => u.platform_domain === 'pcg' || u.platform_domain === 'both' || u.is_super_admin
    );

    return NextResponse.json({
      success: true,
      users: pcgUsers.map((u) => {
        const assignedTl = resolveTlForRm(u.name, customTeamMap);
        return {
          userId: u.user_id,
          email: u.email,
          name: u.name,
          role: u.role,
          status: u.status,
          isAdmin: u.role === 'admin',
          isSuperAdmin: Boolean(u.is_super_admin),
          platformDomain: u.platform_domain || 'pcg',
          tlName: assignedTl,
          lastLogin: u.last_login,
          createdAt: u.created_at,
          dormant: !!u.last_login && now - new Date(u.last_login).getTime() > DORMANT_DAYS * 864e5,
          hasPassword: Boolean(u.password_hash),
        };
      }),
    });
  } catch (err: any) {
    console.error('[pcg/admin/users] GET failed:', err?.message);
    return NextResponse.json({ error: 'Failed to load PCG users.' }, { status: 500 });
  }
}

// POST — Invite new PCG user
export async function POST(req: NextRequest) {
  const { session, response, isSuperAdmin } = await requirePcgAdmin();
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email || '');
  const name = normalizeName(body.name || '');
  const role: UserRole = VALID_ROLES.includes(body.role) ? body.role : 'agent';
  const assignedTl = typeof body.tlName === 'string' ? body.tlName.trim() : '';

  // Domain defaults to 'pcg'. If Super Admin requested 'both', allow it
  const platformDomain = isSuperAdmin && body.platformDomain === 'both' ? 'both' : 'pcg';
  const superAdminFlag = isSuperAdmin && Boolean(body.isSuperAdmin);

  if (!email || !isAllowedEmail(email)) {
    return NextResponse.json({ error: 'A valid @wintwealth.com email is required.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  }

  const actor = session.user?.email || 'pcg-admin';

  let user;
  try {
    user = await createInvite({
      email,
      name,
      role,
      createdBy: actor,
      platformDomain,
      isSuperAdmin: superAdminFlag,
    });
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'A user with this email or name already exists.' }, { status: 409 });
    }
    console.error('[pcg/admin/users] invite failed:', err?.message);
    return NextResponse.json({ error: 'Failed to create user.' }, { status: 500 });
  }

  // If a TL was assigned during invite, save to PCG team assignments
  if (assignedTl) {
    try {
      const config = await readConfig();
      const currentMap = config.pcgTeamAssignments || {};
      currentMap[name.toLowerCase()] = assignedTl;
      await writeConfig({ ...config, pcgTeamAssignments: currentMap });
    } catch (err: any) {
      console.warn('[pcg/admin/users] could not save team assignment:', err?.message);
    }
  }

  // Issue single-use signup token and send invite email
  let emailed = false;
  if (mailerConfigured()) {
    try {
      const { token, expiresAt } = await createSignupToken(user.user_id, user.email);
      emailed = await sendInviteEmail({ to: user.email, name: user.name, token, expiresAt });
    } catch (err: any) {
      console.error('[pcg/admin/users] invite email failed:', err?.message);
    }
  }

  return NextResponse.json({
    success: true,
    user: {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      platformDomain: user.platform_domain,
      isSuperAdmin: user.is_super_admin,
      tlName: assignedTl || 'Unassigned',
    },
    emailed,
  });
}

// PATCH — Edit role, status, profile, TL assignment, or resend invite
export async function PATCH(req: NextRequest) {
  const { session, response, isSuperAdmin } = await requirePcgAdmin();
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const userId = Number(body.userId);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const actor = session.user?.email || 'pcg-admin';
  const target = await getUserById(userId);
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  // Resend invite
  if (body.action === 'resend') {
    if (!mailerConfigured()) {
      return NextResponse.json({ error: 'Email delivery is not configured.' }, { status: 503 });
    }
    const { token, expiresAt } = await createSignupToken(target.user_id, target.email);
    const emailed = await sendInviteEmail({ to: target.email, name: target.name, token, expiresAt });
    await audit('resend_invite', { actorEmail: actor, targetEmail: target.email }).catch(() => {});
    return NextResponse.json({ success: true, emailed });
  }

  // Edit Name and/or Email
  if (body.name !== undefined || body.email !== undefined) {
    const patch: { name?: string; email?: string } = {};
    if (body.name !== undefined) {
      const nm = normalizeName(body.name || '');
      if (!nm) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
      patch.name = nm;
    }
    if (body.email !== undefined) {
      const em = normalizeEmail(body.email || '');
      if (!em || !isAllowedEmail(em)) {
        return NextResponse.json({ error: 'A valid @wintwealth.com email is required.' }, { status: 400 });
      }
      patch.email = em;
    }
    try {
      await updateUserProfile(userId, patch, actor);
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: 'That email or name is already used by another user.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update user profile.' }, { status: 500 });
    }
  }

  // Role change
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }
    await changeRole(userId, body.role, actor);
  }

  // Status change (active / disabled)
  if (body.status !== undefined) {
    const status = body.status as UserStatus;
    if (!['invited', 'active', 'disabled'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }
    if (target.email === normalizeEmail(actor) && status !== 'active') {
      return NextResponse.json({ error: "You cannot disable your own account." }, { status: 400 });
    }
    await changeStatus(userId, status, actor);
  }

  // Team Lead Assignment
  if (body.tlName !== undefined) {
    try {
      const config = await readConfig();
      const currentMap = { ...(config.pcgTeamAssignments || {}) };
      const rmKey = (body.name || target.name).toLowerCase().trim();
      if (!body.tlName || body.tlName === 'Unassigned') {
        delete currentMap[rmKey];
      } else {
        currentMap[rmKey] = body.tlName;
      }
      await writeConfig({ ...config, pcgTeamAssignments: currentMap });
    } catch (err: any) {
      console.warn('[pcg/admin/users] could not update team assignment:', err?.message);
    }
  }

  // Domain change (Super Admin only)
  if (isSuperAdmin && (body.platformDomain !== undefined || body.isSuperAdmin !== undefined)) {
    const domain = body.platformDomain || target.platform_domain;
    const superFlag = body.isSuperAdmin !== undefined ? Boolean(body.isSuperAdmin) : target.is_super_admin;
    await updateUserDomain(userId, domain, superFlag, actor);
  }

  return NextResponse.json({ success: true });
}

// DELETE — Soft-disable user
export async function DELETE(req: NextRequest) {
  const { session, response } = await requirePcgAdmin();
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const userId = Number(body.userId);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const actor = session.user?.email || 'pcg-admin';
  const target = await getUserById(userId);
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }
  if (target.email === normalizeEmail(actor)) {
    return NextResponse.json({ error: "You cannot disable your own account." }, { status: 400 });
  }

  await changeStatus(userId, 'disabled', actor);
  return NextResponse.json({ success: true });
}
