import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';
import type { UserRole } from '@/next-auth';

async function adminOnly() {
  const session = await getServerSession(authOptions);
  return session?.user?.isAdmin ? session : null;
}

// GET — list users (no passwords)
export async function GET() {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const config = await readConfig();
  return NextResponse.json(config.users.map(u => ({
    username: u.email || u.username,
    email: u.email || u.username,
    role: u.role || (u.isAdmin ? 'admin' : 'agent'),
    isAdmin: u.role === 'admin' || !!u.isAdmin,
  })));
}

// POST — add/invite a user by email with a role
export async function POST(req: NextRequest) {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { email, role } = await req.json();
  if (!email?.trim()) return NextResponse.json({ error: 'Email required' }, { status: 400 });
  if (!email.endsWith('@wintwealth.com')) return NextResponse.json({ error: 'Only @wintwealth.com emails allowed' }, { status: 400 });

  const validRoles: UserRole[] = ['agent', 'admin', 'quality', 'tl'];
  const assignedRole: UserRole = validRoles.includes(role) ? role : 'agent';

  const config = await readConfig();
  const existing = config.users.find(u => u.email === email || u.username === email);
  if (existing) {
    // Update role if user already exists
    existing.role = assignedRole;
    existing.isAdmin = assignedRole === 'admin';
    await writeConfig(config);
    return NextResponse.json({ success: true, updated: true });
  }

  config.users.push({
    username: email,
    email,
    role: assignedRole,
    isAdmin: assignedRole === 'admin',
  });
  await writeConfig(config);
  return NextResponse.json({ success: true });
}

// PATCH — update a user's role
export async function PATCH(req: NextRequest) {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { email, role } = await req.json();
  if (!email || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const validRoles: UserRole[] = ['agent', 'admin', 'quality', 'tl'];
  if (!validRoles.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

  const config = await readConfig();
  const user = config.users.find(u => u.email === email || u.username === email);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  user.role = role as UserRole;
  user.isAdmin = role === 'admin';
  await writeConfig(config);
  return NextResponse.json({ success: true });
}

// DELETE — remove user
export async function DELETE(req: NextRequest) {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { email } = await req.json();

  const config = await readConfig();
  const session = await getServerSession(authOptions);
  const currentEmail = session?.user?.email;
  if (currentEmail === email) return NextResponse.json({ error: "Can't delete yourself" }, { status: 400 });

  config.users = config.users.filter(u => u.email !== email && u.username !== email);
  await writeConfig(config);
  return NextResponse.json({ success: true });
}
