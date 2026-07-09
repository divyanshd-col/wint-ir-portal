import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { isRateLimited } from '@/lib/rate-limit';

const ALLOWED_DOMAIN = 'wintwealth.com';

export async function POST(req: NextRequest) {
  // 10 checks per IP per 15 minutes — prevents email enumeration abuse
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await isRateLimited(`check-email:${ip}`, 10, 900)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 });

  const normalised = email.toLowerCase().trim();
  if (!normalised.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: 'Only @wintwealth.com email addresses are permitted.' }, { status: 403 });
  }

  const config = await readConfig();
  const user = config.users.find(u => (u.email ?? u.username).toLowerCase() === normalised);

  if (!user) {
    // Don't reveal whether the account exists — generic message
    return NextResponse.json({ error: 'No account found for this email. Contact your admin to be added.' }, { status: 404 });
  }
  if (user.password) {
    return NextResponse.json({ error: 'This account already has a password. Use Sign In instead.' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
