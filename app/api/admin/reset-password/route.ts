import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { email, newPassword } = await req.json();
  if (!email || !newPassword) {
    return NextResponse.json({ error: 'email and newPassword are required' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const config = await readConfig();
  const idx = config.users.findIndex(
    u => (u.email ?? u.username).toLowerCase() === email.toLowerCase().trim()
  );
  if (idx < 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  config.users[idx] = { ...config.users[idx], password: hashed };
  await writeConfig(config);

  return NextResponse.json({ ok: true });
}
