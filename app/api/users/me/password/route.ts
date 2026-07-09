const ROUTE = 'users/me/password';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';
import bcrypt from 'bcryptjs';

async function _PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const email = session.user.email;
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username) === email);

  if (!user?.password) {
    return NextResponse.json({ error: 'No password set for this account' }, { status: 400 });
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await writeConfig(config);
  return NextResponse.json({ success: true });
}

export const PATCH = withLogging(ROUTE, _PATCH);
