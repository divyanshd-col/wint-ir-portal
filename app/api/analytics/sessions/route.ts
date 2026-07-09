const ROUTE = 'analytics/sessions';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { createSession, updateSessionTitle, deleteSession } from '@/lib/analytics/sessions';

async function getEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) return null;
  return session!.user!.email ?? '';
}

// POST — create a new session
async function _POST(req: Request) {
  const email = await getEmail();
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const title: string = (body.title ?? 'New chat').slice(0, 80);
  const id = await createSession(email, title);
  return NextResponse.json({ id });
}

// PATCH — rename a session
async function _PATCH(req: Request) {
  const email = await getEmail();
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { id, title } = body;
  if (!id || !title) return NextResponse.json({ error: 'id and title required' }, { status: 400 });
  await updateSessionTitle(email, id, String(title).slice(0, 80));
  return NextResponse.json({ ok: true });
}

// DELETE — remove a session and its messages
async function _DELETE(req: Request) {
  const email = await getEmail();
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await deleteSession(email, id);
  return NextResponse.json({ ok: true });
}

export const POST = withLogging(ROUTE, _POST);
export const DELETE = withLogging(ROUTE, _DELETE);
export const PATCH = withLogging(ROUTE, _PATCH);
