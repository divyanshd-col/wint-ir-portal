import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const email  = session.user.email;
  const config = await readConfig();
  const user   = config.users.find(u => (u.email || u.username) === email);

  return NextResponse.json({
    email,
    role:      user?.role ?? (session.user as any)?.role ?? 'agent',
    agentName: user?.agentName ?? (session.user as any)?.agentName ?? '',
    isAdmin:   user?.role === 'admin' || !!(session.user as any)?.isAdmin,
  });
}
