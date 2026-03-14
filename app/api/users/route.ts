import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';
import bcrypt from 'bcryptjs';

async function adminOnly() {
  const session = await getServerSession(authOptions);
  return session?.user?.isAdmin ? session : null;
}

// GET — list users (no passwords)
export async function GET() {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const config = await readConfig();
  return NextResponse.json(config.users.map(u => ({ username: u.username, isAdmin: !!u.isAdmin })));
}

// POST — add user
export async function POST(req: NextRequest) {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { username, password, isAdmin } = await req.json();
  if (!username?.trim() || !password?.trim()) return NextResponse.json({ error: 'Username and password required' }, { status: 400 });

  const config = await readConfig();
  if (config.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
  }

  const hashed = await bcrypt.hash(password, 10);
  config.users.push({ username: username.trim(), password: hashed, isAdmin: !!isAdmin });
  await writeConfig(config);
  return NextResponse.json({ success: true });
}

// PATCH — reset password
export async function PATCH(req: NextRequest) {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const config = await readConfig();
  const user = config.users.find(u => u.username === username);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  user.password = await bcrypt.hash(password, 10);
  await writeConfig(config);
  return NextResponse.json({ success: true });
}

// DELETE — remove user
export async function DELETE(req: NextRequest) {
  if (!await adminOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { username } = await req.json();

  const config = await readConfig();
  const session = await getServerSession(authOptions);
  if (session?.user?.name === username) return NextResponse.json({ error: "Can't delete yourself" }, { status: 400 });

  config.users = config.users.filter(u => u.username !== username);
  await writeConfig(config);
  return NextResponse.json({ success: true });
}
