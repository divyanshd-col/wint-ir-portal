import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import type { UserRole } from '@/next-auth';
import {
  listUsers, createInvite, createSignupToken, changeRole, changeStatus,
  getUserById, isUniqueViolation, audit,
  type UserStatus,
} from '@/lib/users';
import { sendInviteEmail, mailerConfigured } from '@/lib/mailer';
import { isAllowedEmail, normalizeEmail, normalizeName } from '@/lib/identity';

const VALID_ROLES: UserRole[] = ['agent', 'admin', 'quality', 'tl'];

async function adminOnly() {
  const session = await getServerSession(authOptions);
  return session?.user?.isAdmin ? session : null;
}

const DORMANT_DAYS = 60;

// GET — list users (no password hashes)
export async function GET() {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const users = await listUsers();
  const now = Date.now();
  return NextResponse.json(users.map(u => ({
    userId: u.user_id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    isAdmin: u.role === 'admin',
    agentName: u.name,
    assignedDispositions: u.assigned_dispositions || [],
    lastLogin: u.last_login,
    dormant: !!u.last_login && (now - new Date(u.last_login).getTime()) > DORMANT_DAYS * 864e5,
  })));
}

// POST — invite a user (email + name + role) → creates invited user, emails link
export async function POST(req: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email || '');
  const name = normalizeName(body.name || '');
  const role: UserRole = VALID_ROLES.includes(body.role) ? body.role : 'agent';
  const assignedDispositions: string[] | undefined =
    Array.isArray(body.assignedDispositions) && body.assignedDispositions.length ? body.assignedDispositions : undefined;

  if (!email || !isAllowedEmail(email)) {
    return NextResponse.json({ error: 'A valid @wintwealth.com email is required.' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });

  const actor = session.user?.email || 'admin';

  let user;
  try {
    user = await createInvite({ email, name, role, assignedDispositions, createdBy: actor });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'A user with this email or name already exists.' }, { status: 409 });
    }
    console.error('[users] invite failed:', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to create user.' }, { status: 500 });
  }

  // Create a signup token and email it. A send failure is non-fatal: the user
  // stays `invited` and the admin can Resend.
  let emailed = false;
  if (mailerConfigured()) {
    try {
      const { token, expiresAt } = await createSignupToken(user.user_id, user.email);
      emailed = await sendInviteEmail({ to: user.email, name: user.name, token, expiresAt });
    } catch (err) {
      console.error('[users] invite email failed:', (err as Error)?.message);
    }
  }

  return NextResponse.json({ success: true, userId: user.user_id, emailed });
}

// PATCH — update role and/or status (disable/reactivate), or resend invite
export async function PATCH(req: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId = Number(body.userId);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'userId is required.' }, { status: 400 });

  const actor = session.user?.email || 'admin';
  const target = await getUserById(userId);
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  // Resend invite (regenerate token + email) — only meaningful for invited users
  if (body.action === 'resend') {
    if (!mailerConfigured()) return NextResponse.json({ error: 'Email is not configured.' }, { status: 503 });
    const { token, expiresAt } = await createSignupToken(target.user_id, target.email);
    const emailed = await sendInviteEmail({ to: target.email, name: target.name, token, expiresAt });
    await audit('resend_invite', { actorEmail: actor, targetEmail: target.email }).catch(() => {});
    return NextResponse.json({ success: true, emailed });
  }

  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    await changeRole(userId, body.role, actor);
  }

  if (body.status !== undefined) {
    const status = body.status as UserStatus;
    if (!['invited', 'active', 'disabled'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }
    if (target.email === normalizeEmail(actor) && status !== 'active') {
      return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
    }
    await changeStatus(userId, status, actor);
  }

  return NextResponse.json({ success: true });
}

// DELETE — soft-disable (offboard without losing role/name/history)
export async function DELETE(req: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId = Number(body.userId);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'userId is required.' }, { status: 400 });

  const actor = session.user?.email || 'admin';
  const target = await getUserById(userId);
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (target.email === normalizeEmail(actor)) {
    return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
  }

  await changeStatus(userId, 'disabled', actor);
  return NextResponse.json({ success: true });
}
