// Postgres-backed user identity service — the source of truth that replaces
// the config.users JSON blob. All mutations run inside a transaction so
// concurrent admin edits can't clobber each other (the blob's failure mode).
//
// See the identity PRD / plan. Attribution always joins on the normalized
// `name`; login always resolves on the normalized `email`.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, withTransaction, type TxClient } from '@/lib/cx/db';
import { normalizeEmail, normalizeName } from '@/lib/identity';
import type { UserRole } from '@/next-auth';

export type UserStatus = 'invited' | 'active' | 'disabled';

export interface DbUser {
  user_id: number;
  email: string;
  name: string;
  password_hash: string | null;
  role: UserRole;
  status: UserStatus;
  assigned_dispositions: string[] | null;
  last_login: string | null;
  created_at: string;
  created_by: string;
  status_changed_at: string | null;
  status_changed_by: string | null;
  google_sub: string | null;
}

const USER_COLS = `user_id, email, name, password_hash, role, status,
  assigned_dispositions, last_login, created_at, created_by,
  status_changed_at, status_changed_by, google_sub`;

const SIGNUP_TOKEN_TTL_DAYS = 15;

/** Postgres unique-violation SQLSTATE — let routes map this to a 409. */
export function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505';
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const norm = normalizeEmail(email);
  const alt = norm === 'anwesha@wintwealth.com' ? 'anwesha.mandal@wintwealth.com' : norm;
  const rows = await query<DbUser>(`SELECT ${USER_COLS} FROM users WHERE email = $1 OR email = $2`, [norm, alt]);
  return rows[0] ?? null;
}

export async function getUserByName(name: string): Promise<DbUser | null> {
  const rows = await query<DbUser>(`SELECT ${USER_COLS} FROM users WHERE name = $1`, [normalizeName(name)]);
  return rows[0] ?? null;
}

export async function getUserById(userId: number): Promise<DbUser | null> {
  const rows = await query<DbUser>(`SELECT ${USER_COLS} FROM users WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<DbUser[]> {
  return query<DbUser>(`SELECT ${USER_COLS} FROM users ORDER BY name ASC`);
}

/** Resolve a webhook agent_name to a user_id via exact (normalized) name match. */
export async function resolveUserIdByName(agentName: string): Promise<number | null> {
  const rows = await query<{ user_id: number }>(`SELECT user_id FROM users WHERE name = $1`, [normalizeName(agentName)]);
  return rows[0]?.user_id ?? null;
}

// ── Audit (append-only) ──────────────────────────────────────────────────────

export type AuditAction =
  | 'invite' | 'resend_invite' | 'signup_completed'
  | 'login_success' | 'login_fail'
  | 'role_change' | 'status_change' | 'signup_link_expired'
  | 'name_change' | 'email_change';

export async function audit(
  action: AuditAction,
  opts: { actorEmail?: string | null; targetEmail?: string | null; detail?: unknown } = {},
  tx?: TxClient,
): Promise<void> {
  const runner: Pick<TxClient, 'query'> = tx ?? { query };
  await runner.query(
    `INSERT INTO identity_audit (actor_email, action, target_email, detail) VALUES ($1, $2, $3, $4)`,
    [opts.actorEmail ?? null, action, opts.targetEmail ?? null, opts.detail != null ? JSON.stringify(opts.detail) : null],
  );
}

// ── Invite / signup ──────────────────────────────────────────────────────────

export interface CreateInviteInput {
  email: string;
  name: string;
  role: UserRole;
  assignedDispositions?: string[];
  createdBy: string; // admin email
}

/** Creates an `invited` user. Throws on unique violation (email/name) — the
 *  route should map that to a 409. */
export async function createInvite(input: CreateInviteInput): Promise<DbUser> {
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  return withTransaction(async (tx) => {
    const rows = await tx.query<DbUser>(
      `INSERT INTO users (email, name, role, status, assigned_dispositions, created_by)
       VALUES ($1, $2, $3, 'invited', $4, $5)
       RETURNING ${USER_COLS}`,
      [email, name, input.role, input.assignedDispositions?.length ? input.assignedDispositions : null, normalizeEmail(input.createdBy)],
    );
    await audit('invite', { actorEmail: input.createdBy, targetEmail: email, detail: { role: input.role, name } }, tx);
    return rows[0];
  });
}

export interface SignupTokenResult { token: string; expiresAt: Date; }

/** Issues a fresh single-use signup token, invalidating any prior unused ones
 *  for the user (so a resend supersedes the old link). */
export async function createSignupToken(userId: number, email: string): Promise<SignupTokenResult> {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SIGNUP_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE signup_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await tx.query(
      `INSERT INTO signup_tokens (token_hash, user_id, email, expires_at) VALUES ($1, $2, $3, $4)`,
      [tokenHash, userId, normalizeEmail(email), expiresAt.toISOString()],
    );
  });
  return { token, expiresAt };
}

export interface CompleteSignupResult { ok: boolean; error?: string; user?: DbUser; }

/** Consumes a signup token and sets the password, flipping invited → active.
 *  Validates: token exists, not used, not expired, and still bound to the
 *  user's current email. */
export async function completeSignup(token: string, password: string): Promise<CompleteSignupResult> {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(password, 10);
  return withTransaction(async (tx) => {
    const tokRows = await tx.query<{ user_id: number; email: string; expires_at: string; used_at: string | null }>(
      `SELECT user_id, email, expires_at, used_at FROM signup_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const tok = tokRows[0];
    if (!tok) return { ok: false, error: 'Invalid link.' };
    if (tok.used_at) return { ok: false, error: 'This link has already been used.' };
    if (new Date(tok.expires_at).getTime() < Date.now()) return { ok: false, error: 'This link has expired. Ask an admin to resend the invite.' };

    const userRows = await tx.query<DbUser>(`SELECT ${USER_COLS} FROM users WHERE user_id = $1 FOR UPDATE`, [tok.user_id]);
    const user = userRows[0];
    if (!user) return { ok: false, error: 'Account not found.' };
    if (normalizeEmail(user.email) !== normalizeEmail(tok.email)) {
      return { ok: false, error: 'This link is no longer valid.' };
    }

    await tx.query(
      `UPDATE users SET password_hash = $1, status = 'active', status_changed_at = NOW(), status_changed_by = $2 WHERE user_id = $3`,
      [passwordHash, user.email, user.user_id],
    );
    // Consume this token and invalidate any siblings.
    await tx.query(`UPDATE signup_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [user.user_id]);
    await audit('signup_completed', { targetEmail: user.email, detail: { user_id: user.user_id } }, tx);
    return { ok: true, user: { ...user, status: 'active', password_hash: passwordHash } };
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function changeStatus(userId: number, status: UserStatus, actorEmail: string): Promise<void> {
  await withTransaction(async (tx) => {
    const rows = await tx.query<{ status: string; email: string }>(
      `SELECT status, email FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
    const cur = rows[0];
    if (!cur) throw new Error('User not found');
    if (cur.status === status) return;
    await tx.query(
      `UPDATE users SET status = $1, status_changed_at = NOW(), status_changed_by = $2 WHERE user_id = $3`,
      [status, normalizeEmail(actorEmail), userId]);
    await audit('status_change', { actorEmail, targetEmail: cur.email, detail: { from: cur.status, to: status } }, tx);
  });
}

export interface UpdateProfileInput { name?: string; email?: string; }

/** Admin edit of a user's Name and/or email. Normalizes, enforces uniqueness
 *  (throws 23505 → route maps to 409), and keeps side effects consistent:
 *   - email change → invalidates any outstanding signup token (it was bound to
 *     the old email), and audits `email_change`.
 *   - name change  → re-points agent attribution to follow the corrected name
 *     (unlink the old agent, link the agent whose name now matches), and audits
 *     `name_change`.
 *  Returns the updated row. */
export async function updateUserProfile(
  userId: number,
  input: UpdateProfileInput,
  actorEmail: string,
): Promise<DbUser> {
  return withTransaction(async (tx) => {
    const rows = await tx.query<DbUser>(`SELECT ${USER_COLS} FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
    const cur = rows[0];
    if (!cur) throw new Error('User not found');

    const newEmail = input.email !== undefined ? normalizeEmail(input.email) : cur.email;
    const newName = input.name !== undefined ? normalizeName(input.name) : cur.name;
    const emailChanged = newEmail !== cur.email;
    const nameChanged = newName !== cur.name;
    if (!emailChanged && !nameChanged) return cur;

    await tx.query(`UPDATE users SET email = $1, name = $2 WHERE user_id = $3`, [newEmail, newName, userId]);

    if (emailChanged) {
      await tx.query(`UPDATE signup_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
      await audit('email_change', { actorEmail, targetEmail: newEmail, detail: { from: cur.email, to: newEmail } }, tx);
    }
    if (nameChanged) {
      // Re-point agent attribution: drop the old link, attach the agent (if any)
      // whose name now matches the corrected Name.
      await tx.query(`UPDATE agents SET user_id = NULL WHERE user_id = $1`, [userId]);
      await tx.query(`UPDATE agents SET user_id = $1 WHERE user_id IS NULL AND name = $2`, [userId, newName]);
      await audit('name_change', { actorEmail, targetEmail: newEmail, detail: { from: cur.name, to: newName } }, tx);
    }

    const updated = await tx.query<DbUser>(`SELECT ${USER_COLS} FROM users WHERE user_id = $1`, [userId]);
    return updated[0];
  });
}

export async function changeRole(userId: number, role: UserRole, actorEmail: string): Promise<void> {
  await withTransaction(async (tx) => {
    const rows = await tx.query<{ role: string; email: string }>(
      `SELECT role, email FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
    const cur = rows[0];
    if (!cur) throw new Error('User not found');
    if (cur.role === role) return;
    await tx.query(`UPDATE users SET role = $1 WHERE user_id = $2`, [role, userId]);
    await audit('role_change', { actorEmail, targetEmail: cur.email, detail: { from: cur.role, to: role } }, tx);
  });
}

export async function recordLogin(userId: number): Promise<void> {
  await query(`UPDATE users SET last_login = NOW() WHERE user_id = $1`, [userId]);
}

/** Admin-initiated password set. Returns true if a DB user row was updated
 *  (false → caller should fall back to the legacy blob during dual-read). */
export async function setPasswordByEmail(email: string, password: string): Promise<boolean> {
  const passwordHash = await bcrypt.hash(password, 10);
  const rows = await query<{ user_id: number }>(
    `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING user_id`,
    [passwordHash, normalizeEmail(email)],
  );
  return rows.length > 0;
}
