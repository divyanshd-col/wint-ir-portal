const ROUTE = 'register';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readConfig, writeConfig } from '@/lib/config';
import { storeGetConfig } from '@/lib/store';
import { isRateLimited } from '@/lib/rate-limit';

const ALLOWED_DOMAIN = 'wintwealth.com';

async function _POST(req: NextRequest) {
  // 5 registration attempts per IP per 15 minutes
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await isRateLimited(`register:${ip}`, 5, 900)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const config = await readConfig();

  if (!config.isConfigured) {
    return NextResponse.json({ error: 'Portal is not configured yet.' }, { status: 503 });
  }

  const body = await req.json();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: `Only @${ALLOWED_DOMAIN} email addresses are permitted.` }, { status: 403 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const existingIdx = config.users.findIndex(
    u => (u.email ?? u.username).toLowerCase() === email
  );
  // Allow existing users who have no password yet to set one (migration)
  if (existingIdx >= 0 && config.users[existingIdx].password) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  // On Vercel, config must be persisted in KV — check Upstash is available
  const isVercel = !!process.env.VERCEL;
  const kvReady = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (isVercel && !kvReady) {
    return NextResponse.json(
      { error: 'Self-registration is not available. Ask an admin to add your account.' },
      { status: 503 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUsers = [...config.users];
  if (existingIdx >= 0) {
    // Existing user without a password — just set the hash, preserve role/agentName
    newUsers[existingIdx] = { ...newUsers[existingIdx], password: hashedPassword };
  } else {
    newUsers.push({ username: email, email, password: hashedPassword, role: 'agent' });
  }
  const updatedConfig = { ...config, users: newUsers };

  await writeConfig(updatedConfig);

  // Verify the write actually persisted (guards against silent KV failures)
  const saved = await storeGetConfig();
  const persisted = saved?.users?.some(u => (u.email ?? u.username) === email);
  if (isVercel && !persisted) {
    return NextResponse.json(
      { error: 'Failed to save account. Please try again or contact an admin.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

export const POST = withLogging(ROUTE, _POST);
