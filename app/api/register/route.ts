import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readConfig, writeConfig } from '@/lib/config';
import { storeGetConfig } from '@/lib/store';

export async function POST(req: NextRequest) {
  const config = await readConfig();

  if (!config.isConfigured) {
    return NextResponse.json({ error: 'Portal is not configured yet.' }, { status: 503 });
  }

  const body = await req.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
  }
  if (username.length < 3) {
    return NextResponse.json({ error: 'Username must be at least 3 characters.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const exists = config.users.some(u => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });
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
  const updatedConfig = {
    ...config,
    users: [...config.users, { username, password: hashedPassword, isAdmin: false }],
  };

  await writeConfig(updatedConfig);

  // Verify the write actually persisted (guards against silent KV failures)
  const saved = await storeGetConfig();
  const persisted = saved?.users?.some(u => u.username === username);
  if (isVercel && !persisted) {
    return NextResponse.json(
      { error: 'Failed to save account. Please try again or contact an admin.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
