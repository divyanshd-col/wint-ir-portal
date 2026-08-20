import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { listConnections, revokeConnection } from '@/lib/mcp/oauth';

// Admin view of active OAuth connections to the Analytics MCP. Replaces the old
// static-token manager: connections are created by users completing the OAuth
// login + consent flow, and an admin can revoke any of them here.
export const runtime = 'nodejs';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string } | undefined;
  if (!user || user.role !== 'admin') return null;
  return user;
}

// GET — list every (user, client) connection, active or revoked.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const connections = await listConnections();
  return NextResponse.json({ connections });
}

// DELETE — revoke a connection (all access + refresh tokens for a user+client).
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { userId?: number; clientId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.userId !== 'number' || !body.clientId) {
    return NextResponse.json({ error: 'userId and clientId are required' }, { status: 400 });
  }

  const ok = await revokeConnection(body.userId, body.clientId);
  if (!ok) return NextResponse.json({ error: 'No active connection found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
