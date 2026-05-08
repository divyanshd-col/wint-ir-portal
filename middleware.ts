import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/setup' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/set-password'
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // CX dashboard: all authenticated roles
  // (role enforcement is done per-page and per-API-route)
  // No restriction needed here — just let authenticated users through

  // Quality section: admin, quality, tl — plus agent (sees own-only dashboard)
  if (pathname.startsWith('/quality')) {
    const role = token.role as string | undefined;
    if (!role || !['admin', 'quality', 'tl', 'agent'].includes(role)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Analytics: admin and TL
  if (pathname.startsWith('/analytics')) {
    if (!token.isAdmin && token.role !== 'tl') {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Call analysis: admin and TL
  if (pathname.startsWith('/call-analysis')) {
    if (!token.isAdmin && token.role !== 'tl') {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
