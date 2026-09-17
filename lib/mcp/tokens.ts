import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { query } from '@/lib/cx/db';

// ── Types ─────────────────────────────────────────────────────────────────────

// Roles allowed to use the Analytics MCP — mirrors the /analytics page gate
// (admin + tl). Kept here so both the token API and the MCP endpoint agree.
export const MCP_ALLOWED_ROLES = ['admin', 'tl'] as const;

export interface McpTokenUser {
  userId: number;
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
}

export interface McpTokenRow {
  id: string;
  label: string;
  userId: number;
  userEmail: string;
  userName: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const TOKEN_PREFIX = 'wint_mcp_';

// ── Table bootstrap (self-heals if migration 015 was not applied) ──────────────

let tableEnsured = false;
export async function ensureMcpTokensTable(): Promise<void> {
  if (tableEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id            BIGSERIAL PRIMARY KEY,
      token_hash    TEXT NOT NULL UNIQUE,
      user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      label         VARCHAR(120) NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by    VARCHAR(255) NOT NULL,
      last_used_at  TIMESTAMPTZ,
      revoked_at    TIMESTAMPTZ
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens (user_id)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_mcp_tokens_active ON mcp_tokens (token_hash) WHERE revoked_at IS NULL`,
  );
  tableEnsured = true;
}

// ── Hashing ───────────────────────────────────────────────────────────────────
// The raw token is 256 bits of CSPRNG output, so a plain SHA-256 is the right
// store: it is deterministic (so we can look up by hash) and there is nothing to
// brute-force. bcrypt (salted, non-deterministic) would make lookup impossible.

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createToken(opts: {
  userId: number;
  label: string;
  createdBy: string;
}): Promise<{ id: string; rawToken: string }> {
  await ensureMcpTokensTable();
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const rows = await query<{ id: string }>(
    `INSERT INTO mcp_tokens (token_hash, user_id, label, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text AS id`,
    [tokenHash, opts.userId, opts.label.slice(0, 120), opts.createdBy],
  );
  return { id: rows[0].id, rawToken };
}

// ── Verify (called by the MCP endpoint on every request) ───────────────────────

export async function verifyToken(raw: string | undefined | null): Promise<McpTokenUser | null> {
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;
  await ensureMcpTokensTable();

  const tokenHash = hashToken(raw.trim());
  const rows = await query<{
    id: string;
    stored_hash: string;
    user_id: number;
    email: string;
    name: string;
    role: string;
    status: string;
  }>(
    `SELECT t.id::text AS id, t.token_hash AS stored_hash,
            u.user_id, u.email, u.name, u.role, u.status
       FROM mcp_tokens t
       JOIN users u ON u.user_id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL
      LIMIT 1`,
    [tokenHash],
  );
  if (!rows.length) return null;

  const row = rows[0];
  // Constant-time confirmation of the hash match (defence in depth; the WHERE
  // already matched on the unique hash).
  const a = Buffer.from(tokenHash, 'hex');
  const b = Buffer.from(row.stored_hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (row.status !== 'active') return null;
  if (!MCP_ALLOWED_ROLES.includes(row.role as (typeof MCP_ALLOWED_ROLES)[number])) return null;

  // Best-effort last-used bump — never block auth on it.
  query(`UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});

  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    isAdmin: row.role === 'admin',
  };
}

// ── List / revoke (admin UI) ───────────────────────────────────────────────────

interface RawTokenRow {
  id: string;
  label: string;
  user_id: number;
  user_email: string;
  user_name: string;
  created_at: string;
  created_by: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function listTokens(): Promise<McpTokenRow[]> {
  await ensureMcpTokensTable();
  const rows = await query<RawTokenRow>(
    `SELECT t.id::text AS id, t.label, t.user_id,
            u.email AS user_email, u.name AS user_name,
            t.created_at, t.created_by, t.last_used_at, t.revoked_at
       FROM mcp_tokens t
       JOIN users u ON u.user_id = t.user_id
      ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    createdAt: r.created_at,
    createdBy: r.created_by,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  }));
}

export async function revokeToken(id: string): Promise<boolean> {
  await ensureMcpTokensTable();
  const rows = await query<{ id: string }>(
    `UPDATE mcp_tokens SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id::text AS id`,
    [id],
  );
  return rows.length > 0;
}
