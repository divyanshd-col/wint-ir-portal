import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';
import { setPasswordByEmail } from '@/lib/users';
import { validatePassword, normalizeEmail } from '@/lib/identity';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { email, newPassword } = await req.json();
  if (!email || !newPassword) {
    return NextResponse.json({ error: 'email and newPassword are required' }, { status: 400 });
  }
  const pw = validatePassword(newPassword);
  if (!pw.ok) {
    return NextResponse.json({ error: pw.error }, { status: 400 });
  }

  const normalized = normalizeEmail(email);

  // Primary: Postgres users table.
  try {
    const updated = await setPasswordByEmail(normalized, newPassword);
    if (updated) return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reset-password] DB update failed, trying blob:', (err as Error)?.message);
  }

  // Fallback: legacy config.users blob (pre-backfill users).
  const config = await readConfig();
  const idx = config.users.findIndex(
    u => (u.email ?? u.username).toLowerCase() === normalized
  );
  if (idx < 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const hashed = await bcrypt.hash(newPassword, 10);
  config.users[idx] = { ...config.users[idx], password: hashed };
  await writeConfig(config);

  return NextResponse.json({ ok: true });
}
