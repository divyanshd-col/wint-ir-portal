import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const domain = body.domain;
    if (domain !== 'cx' && domain !== 'pcg') {
      return NextResponse.json({ error: 'Invalid domain. Must be "cx" or "pcg".' }, { status: 400 });
    }

    // Only Super Admins or users configured with 'both' access can switch domains
    const isSuperAdmin = Boolean(session.user.isSuperAdmin);
    const platformDomain = session.user.platformDomain;

    if (!isSuperAdmin && platformDomain !== 'both') {
      return NextResponse.json(
        { error: 'Forbidden: Super Admin access is required to switch workspace profiles.' },
        { status: 403 }
      );
    }

    const response = NextResponse.json({
      success: true,
      activeDomain: domain,
      message: `Switched active workspace profile to ${domain.toUpperCase()}`,
    });

    // Set cookie for middleware and client components (30 days persistence)
    response.cookies.set('wint_active_domain', domain, {
      path: '/',
      httpOnly: false, // accessible to client scripts
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (err: any) {
    console.error('[switch-domain] Error switching profile domain:', err);
    return NextResponse.json({ error: 'Failed to switch workspace profile' }, { status: 500 });
  }
}
