import { NextRequest, NextResponse } from 'next/server';
import { completeSignup } from '@/lib/users';
import { validatePassword } from '@/lib/identity';
import { isRateLimited } from '@/lib/rate-limit';

/**
 * POST /api/auth/complete-signup
 * Body: { token, password }
 * Consumes a single-use signup token and sets the user's password
 * (invited → active). Public route (the token is the credential).
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await isRateLimited(`signup:${ip}`, 10, 900)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token) return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });

  const pw = validatePassword(password);
  if (!pw.ok) return NextResponse.json({ error: pw.error }, { status: 400 });

  const result = await completeSignup(token, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
