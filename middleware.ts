import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

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

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
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
      'quality:analytics:access', 'tl:team_analytics:access', 'tl:member_analytics:access',
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

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
