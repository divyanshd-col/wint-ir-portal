import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { createToken, listTokens, MCP_ALLOWED_ROLES } from '@/lib/mcp/tokens';

// Admin management of static personal MCP tokens — the bearer tokens IDE / desktop
// MCP clients (Antigravity, Cursor, etc.) paste into their config to reach the
// Analytics MCP. claude.ai uses OAuth instead (app/api/admin/mcp-connections).
export const runtime = 'nodejs';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string } | undefined;
  if (!user || user.role !== 'admin') return null;
  return user;
}

interface EligibleUser {
  user_id: number;
  name: string;
  email: string;
  role: string;
}

// GET — list tokens + the users who may hold one (active admin / tl).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tokens = await listTokens();
  const eligibleUsers = await query<EligibleUser>(
    `SELECT user_id, name, email, role
       FROM users
      WHERE role = ANY($1) AND status = 'active'
      ORDER BY name`,
    [MCP_ALLOWED_ROLES as unknown as string[]],
  );
  return NextResponse.json({ tokens, eligibleUsers });
}

// POST — mint a token for an eligible user. The raw token is returned once.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { userId?: number; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const { userId, label } = body;
  if (typeof userId !== 'number' || !label || !label.trim()) {
    return NextResponse.json({ error: 'userId and label are required' }, { status: 400 });
  }

  // Only mint for an active admin / tl.
  const rows = await query<{ user_id: number }>(
    `SELECT user_id FROM users WHERE user_id = $1 AND role = ANY($2) AND status = 'active' LIMIT 1`,
    [userId, MCP_ALLOWED_ROLES as unknown as string[]],
  );
  if (!rows.length) {
    return NextResponse.json({ error: 'User must be an active admin or TL' }, { status: 400 });
  }

  const { id, rawToken } = await createToken({
    userId,
    label: label.trim(),
    createdBy: admin.email ?? 'admin',
  });
  return NextResponse.json({ id, token: rawToken });
}
