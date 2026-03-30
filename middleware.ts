import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/setup' ||
    pathname === '/login'
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Quality section: only admin, quality, tl
  if (pathname.startsWith('/quality')) {
    const role = token.role as string | undefined;
    if (!role || !['admin', 'quality', 'tl'].includes(role)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Analytics: admin only
  if (pathname.startsWith('/analytics')) {
    if (!token.isAdmin) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
