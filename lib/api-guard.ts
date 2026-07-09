import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { NextResponse } from 'next/server';

export async function requireRole(allowedRoles: string[] | string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const role = (session.user as any)?.role;
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  if (!role || !roles.includes(role)) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { session, response: null };
}
