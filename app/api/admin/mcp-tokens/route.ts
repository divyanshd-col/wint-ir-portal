import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { createToken, listTokens, MCP_ALLOWED_ROLES } from '@/lib/mcp/tokens';

export const runtime = 'nodejs';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string; name?: string } | undefined;
  if (!user || user.role !== 'admin') return null;
  return user;
}

// GET — list tokens + the users eligible to hold one (admin/tl, active).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tokens = await listTokens();
  const eligibleUsers = await query<{ user_id: number; name: string; email: string; role: string }>(
    `SELECT user_id, name, email, role
       FROM users
      WHERE status = 'active' AND role = ANY($1)
      ORDER BY name`,
    [MCP_ALLOWED_ROLES as unknown as string[]],
  );

  return NextResponse.json({ tokens, eligibleUsers });
}

// POST — mint a new token for a user. Returns the raw token exactly once.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { userId?: number; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = Number(body.userId);
  const label = (body.label || '').trim();
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 });
  }

  // Confirm the target user exists and is eligible (admin/tl, active).
  const rows = await query<{ user_id: number }>(
    `SELECT user_id FROM users WHERE user_id = $1 AND status = 'active' AND role = ANY($2)`,
    [userId, MCP_ALLOWED_ROLES as unknown as string[]],
  );
  if (!rows.length) {
    return NextResponse.json(
      { error: 'Target user must be an active admin or TL' },
      { status: 400 },
    );
  }

  const { id, rawToken } = await createToken({
    userId,
    label,
    createdBy: admin.email || admin.name || 'admin',
  });

  return NextResponse.json({ id, token: rawToken });
}
