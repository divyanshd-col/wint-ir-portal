import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { NextResponse } from 'next/server';

export interface PcgAdminAuthResult {
  session: any | null;
  response: NextResponse | null;
  isSuperAdmin: boolean;
  isPcgAdmin: boolean;
}

/**
 * Validates that the current user is either a Super Admin or a PCG Admin.
 * Returns { response: NextResponse } with a 401/403 status if unauthorized,
 * or { response: null, session, isSuperAdmin, isPcgAdmin } if authorized.
 */
export async function requirePcgAdmin(): Promise<PcgAdminAuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Unauthorized: Session required.' }, { status: 401 }),
      isSuperAdmin: false,
      isPcgAdmin: false,
    };
  }

  const user = session.user as any;
  const isSuperAdmin = Boolean(user.isSuperAdmin);
  const isAdmin = Boolean(user.isAdmin || user.role === 'admin');
  const platformDomain = user.platformDomain || 'cx';
  const isPcgAdmin = isAdmin && (platformDomain === 'pcg' || platformDomain === 'both');

  if (!isSuperAdmin && !isPcgAdmin) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Forbidden: Access restricted to Super Admin and PCG Admin.' },
        { status: 403 }
      ),
      isSuperAdmin: false,
      isPcgAdmin: false,
    };
  }

  return { session, response: null, isSuperAdmin, isPcgAdmin };
}
