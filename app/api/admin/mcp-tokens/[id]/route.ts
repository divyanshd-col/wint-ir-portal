import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { revokeToken } from '@/lib/mcp/tokens';

export const runtime = 'nodejs';

// DELETE — revoke a token (soft delete; sets revoked_at).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string } | undefined;
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const ok = await revokeToken(id);
  if (!ok) {
    return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
