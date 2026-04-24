import { NextRequest, NextResponse } from 'next/server';
import handler from '@/auth';
import { isRateLimited } from '@/lib/rate-limit';

// Wrap the NextAuth handler to add brute-force protection on sign-in
async function POST(req: NextRequest) {
  const url = new URL(req.url);

  // Only rate-limit the credentials sign-in callback
  if (url.pathname.endsWith('/callback/credentials')) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    // 10 attempts per IP per 15 minutes
    if (await isRateLimited(`login:${ip}`, 10, 900)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again in 15 minutes.' },
        { status: 429 },
      );
    }
  }

  return (handler as any)(req);
}

async function GET(req: NextRequest) {
  return (handler as any)(req);
}

export { GET, POST };
