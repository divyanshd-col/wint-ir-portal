import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';
import { getUserByEmail, setPasswordByEmail, audit } from '@/lib/users';
import bcrypt from 'bcryptjs';

export async function PATCH(req: NextRequest) {
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

  // 1. Primary identity store: PostgreSQL users table
  try {
    const dbUser = await getUserByEmail(email);
    if (dbUser) {
      if (!dbUser.password_hash) {
        return NextResponse.json({ error: 'No password set for this account' }, { status: 400 });
      }
      const valid = await bcrypt.compare(currentPassword, dbUser.password_hash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }

      await setPasswordByEmail(email, newPassword);
      await audit('status_change', {
        actorEmail: email,
        targetEmail: email,
        detail: { action: 'password_updated' },
      }).catch(() => {});

      // Keep legacy config blob in sync if user also exists there
      try {
        const config = await readConfig();
        const cfgUser = config.users?.find(
          (u) => (u.email || u.username || '').toLowerCase() === email.toLowerCase()
        );
        if (cfgUser) {
          cfgUser.password = await bcrypt.hash(newPassword, 10);
          await writeConfig(config);
        }
      } catch (cfgErr) {
        console.warn('[password] config dual-write skipped/failed:', cfgErr);
      }

      return NextResponse.json({ success: true });
    }
  } catch (err: any) {
    console.error('[password] Postgres lookup failed, attempting fallback:', err?.message || err);
  }

  // 2. Fallback: legacy config.users blob
  try {
    const config = await readConfig();
    const user = config.users?.find(
      (u) => (u.email || u.username || '').toLowerCase() === email.toLowerCase()
    );

    if (!user || !user.password) {
      return NextResponse.json({ error: 'No password set for this account' }, { status: 400 });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await writeConfig(config);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to update password' }, { status: 500 });
  }
}

