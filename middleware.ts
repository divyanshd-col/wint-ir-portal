import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isHttpsRequest } from '@/lib/auth-cookie';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    // Public OAuth discovery documents (RFC 8414 / RFC 9728). These are rewritten
    // to /api/oauth/discovery/* and must be reachable without a session so
    // claude.ai's connector can discover the authorization server.
    pathname.startsWith('/.well-known/') ||
    pathname === '/setup' ||
    pathname === '/login' ||
    pathname === '/set-password'
  ) {
    return NextResponse.next();
  }

  // Support both secure (__Secure-next-auth.session-token) and non-secure (next-auth.session-token)
  // cookie names regardless of whether NEXTAUTH_URL has https or localhost http.
  let token = null;
  const hasSecure = req.cookies.has('__Secure-next-auth.session-token');
  const hasPlain = req.cookies.has('next-auth.session-token');

  if (hasSecure) {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie: true });
  }
  if (!token && hasPlain) {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie: false });
  }
  if (!token && !hasSecure && !hasPlain) {
    const isHttps = isHttpsRequest(req.headers.get('x-forwarded-proto'), req.nextUrl.protocol);
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie: isHttps });
    if (!token) {
      token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, secureCookie: !isHttps });
    }
  }
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Fallback map if token was minted before skills array was attached
  const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
    admin: [
      'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
      'quality:analytics:access', 'quality:chat_eval:access', 'quality:call_eval:access',
      'tl:team_analytics:access', 'tl:member_analytics:access', 'tl:quality_chats:access',
      'tl:quality_calls:access', 'tl:reports:access', 'tokens:view:access', 'settings:manage:access',
      'users:manage:access', 'skills:manage:access',
    ],
    tl: [
      'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
      'quality:analytics:access', 'tl:member_analytics:access',
      'tl:quality_chats:access', 'tl:quality_calls:access', 'tl:reports:access',
    ],
    quality: [
      'chat:access', 'cx_dashboard:access', 'quality:analytics:access',
      'quality:chat_eval:access', 'quality:call_eval:access',
    ],
    agent: [
      'chat:access', 'quality:analytics:access', 'agent:my_analytics:access',
      'agent:my_chats:access', 'agent:my_calls:access', 'agent:reports:access',
    ],
  };

  const role = (token.role as string | undefined) || (token.isAdmin ? 'admin' : 'agent');
  const skills = Array.isArray(token.skills) && token.skills.length
    ? (token.skills as string[])
    : (DEFAULT_ROLE_SKILLS[role] || []);

  const isAdmin = token.isAdmin || role === 'admin';
  const isSuperAdmin = Boolean(token.isSuperAdmin);
  const platformDomain = (token.platformDomain as string) || 'cx';
  const cookieDomain = req.cookies.get('wint_active_domain')?.value;

  // Resolve active domain profile (Super Admins can switch; others are fixed to their domain)
  const activeDomain: 'cx' | 'pcg' = (isSuperAdmin || platformDomain === 'both')
    ? (cookieDomain === 'pcg' ? 'pcg' : 'cx')
    : (platformDomain === 'pcg' ? 'pcg' : 'cx');

  const isPcgRoute = pathname.startsWith('/admin/pcg-calls') || pathname.startsWith('/pcg');

  // --- PCG Mode Enforcement ---
  if (activeDomain === 'pcg') {
    // In PCG mode, accessing home or CX tools redirects to PCG dashboard
    if (
      pathname === '/' ||
      pathname.startsWith('/chat') ||
      pathname.startsWith('/analytics') ||
      pathname.startsWith('/call-analysis') ||
      pathname.startsWith('/quality') ||
      pathname.startsWith('/cx') ||
      pathname.startsWith('/tl') ||
      pathname.startsWith('/agent')
    ) {
      return NextResponse.redirect(new URL('/admin/pcg-calls', req.url));
    }
  }

  // --- CX Mode Enforcement ---
  if (activeDomain === 'cx') {
    // Non-super-admins who are CX-only must NOT access PCG routes
    if (isPcgRoute && !isSuperAdmin && platformDomain !== 'both') {
      return NextResponse.redirect(new URL('/quality', req.url));
    }
  }

  const checkSkill = (reqSkill: string | string[]): boolean => {
    if (isAdmin) return true;
    if (Array.isArray(reqSkill)) {
      return reqSkill.some(s => skills.includes(s));
    }
    return skills.includes(reqSkill);
  };

  // Chat & Home
  if (pathname === '/' || pathname.startsWith('/chat')) {
    if (!checkSkill('chat:access')) {
      return NextResponse.redirect(new URL('/quality', req.url));
    }
  }

  // Analytics
  if (pathname.startsWith('/analytics')) {
    if (!checkSkill('analytics:access')) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Call analysis
  if (pathname.startsWith('/call-analysis')) {
    if (!checkSkill('call_analysis:access')) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Quality Tool
  if (pathname.startsWith('/quality/chat-evaluation')) {
    if (!checkSkill('quality:chat_eval:access')) {
      return NextResponse.redirect(new URL('/quality', req.url));
    }
  }
  if (pathname.startsWith('/quality/call-evaluation')) {
    if (!checkSkill('quality:call_eval:access')) {
      return NextResponse.redirect(new URL('/quality', req.url));
    }
  }
  if (pathname.startsWith('/quality')) {
    if (!checkSkill(['quality:analytics:access', 'quality:chat_eval:access', 'quality:call_eval:access'])) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // CX Dashboard
  if (pathname.startsWith('/cx')) {
    if (!checkSkill('cx_dashboard:access')) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Token Usage
  if (pathname.startsWith('/tokens')) {
    if (!checkSkill('tokens:view:access')) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Settings
  if (pathname.startsWith('/settings')) {
    if (!checkSkill('settings:manage:access')) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Team Analytics (restricted to admin)
  if (pathname === '/tl' || pathname === '/tl/') {
    if (!isAdmin) {
      if (checkSkill('tl:member_analytics:access') || checkSkill('agent:my_analytics:access')) {
        return NextResponse.redirect(new URL('/tl/member-analytics', req.url));
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
