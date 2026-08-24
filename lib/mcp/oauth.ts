import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { query, withTransaction } from '@/lib/cx/db';
import { MCP_ALLOWED_ROLES } from '@/lib/mcp/tokens';

// ── Overview ────────────────────────────────────────────────────────────────
// Minimal, hand-rolled OAuth 2.1 authorization server backing the Analytics MCP
// endpoint so claude.ai's web connector can authenticate. Public clients only
// (PKCE S256, no client secret). Codes and tokens are opaque, 256-bit CSPRNG
// values stored as SHA-256 hashes — the raw values live only in the client.
// The real user is authenticated by the /authorize route via the NextAuth
// session; this module never issues anything without a resolved, active
// admin/tl user_id.

// ── Tunables ──────────────────────────────────────────────────────────────────
export const OAUTH_SCOPE = 'analytics:read';
// Human-readable label for the roles allowed to hold an OAuth grant (admin, tl).
export const MCP_ALLOWED_ROLES_LABEL = 'admin & team-lead';
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d
const AUTH_CODE_TTL_SECONDS = 5 * 60; // 5m

const ACCESS_PREFIX = 'wint_at_';
const REFRESH_PREFIX = 'wint_rt_';
const CODE_PREFIX = 'wint_ac_';
const CLIENT_PREFIX = 'wint_client_';

// Redirect-URI host allowlist (hardening). A registered client's redirect URIs
// must be HTTPS and on an Anthropic callback domain, so an authorization code
// can only ever be delivered to Claude — even if a user is tricked into
// approving a rogue client.
const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com'];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface OAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  scope: string | null;
  createdAt: string;
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

export interface AccessTokenContext {
  token: string;
  clientId: string;
  scope: string;
  resource: string | null;
  expiresAt: number; // seconds since epoch
  user: {
    userId: number;
    email: string;
    name: string;
    role: string;
    isAdmin: boolean;
  };
}

export interface OAuthConnection {
  userId: number;
  userEmail: string;
  userName: string;
  clientId: string;
  clientName: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

// ── Hashing (mirrors lib/mcp/tokens.ts) ─────────────────────────────────────────
function hash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function randomToken(prefix: string): string {
  return prefix + randomBytes(32).toString('base64url');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ── Table bootstrap (self-heals if migration 016 was not applied) ───────────────
let tablesEnsured = false;
export async function ensureOAuthTables(): Promise<void> {
  if (tablesEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id                   TEXT PRIMARY KEY,
      client_name                 VARCHAR(255),
      redirect_uris               TEXT[] NOT NULL,
      grant_types                 TEXT[] NOT NULL DEFAULT ARRAY['authorization_code','refresh_token'],
      token_endpoint_auth_method  VARCHAR(40) NOT NULL DEFAULT 'none',
      scope                       TEXT,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_auth_codes (
      code_hash             TEXT PRIMARY KEY,
      client_id             TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      user_id               INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      redirect_uri          TEXT NOT NULL,
      code_challenge        TEXT NOT NULL,
      code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',
      scope                 TEXT NOT NULL,
      resource              TEXT,
      expires_at            TIMESTAMPTZ NOT NULL,
      consumed_at           TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expiry ON oauth_auth_codes (expires_at)`);
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token_hash    TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      client_id     TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      scope         TEXT NOT NULL,
      resource      TEXT,
      expires_at    TIMESTAMPTZ NOT NULL,
      revoked_at    TIMESTAMPTZ,
      last_used_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens (user_id)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_active ON oauth_access_tokens (token_hash) WHERE revoked_at IS NULL`,
  );
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      token_hash    TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      client_id     TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      scope         TEXT NOT NULL,
      resource      TEXT,
      expires_at    TIMESTAMPTZ NOT NULL,
      revoked_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_user ON oauth_refresh_tokens (user_id)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_active ON oauth_refresh_tokens (token_hash) WHERE revoked_at IS NULL`,
  );
  tablesEnsured = true;
}

// ── Redirect-URI allowlist ──────────────────────────────────────────────────────
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_REDIRECT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

// ── Dynamic Client Registration ─────────────────────────────────────────────────
export async function registerClient(opts: {
  redirectUris: string[];
  clientName?: string | null;
  grantTypes?: string[];
  tokenEndpointAuthMethod?: string;
  scope?: string | null;
}): Promise<OAuthClient> {
  // Validate before touching the DB so a bad request fails fast.
  if (!opts.redirectUris.length) {
    throw new OAuthError('invalid_redirect_uri', 'At least one redirect_uri is required.');
  }
  for (const uri of opts.redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      throw new OAuthError(
        'invalid_redirect_uri',
        `redirect_uri "${uri}" is not permitted. Only https URLs on ${ALLOWED_REDIRECT_HOSTS.join(', ')} are allowed.`,
      );
    }
  }

  await ensureOAuthTables();
  const clientId = randomToken(CLIENT_PREFIX);
  const grantTypes =
    opts.grantTypes && opts.grantTypes.length
      ? opts.grantTypes
      : ['authorization_code', 'refresh_token'];
  const authMethod = opts.tokenEndpointAuthMethod || 'none';

  await query(
    `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method, scope)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      clientId,
      opts.clientName ? String(opts.clientName).slice(0, 255) : null,
      opts.redirectUris,
      grantTypes,
      authMethod,
      opts.scope ?? OAUTH_SCOPE,
    ],
  );

  return {
    clientId,
    clientName: opts.clientName ?? null,
    redirectUris: opts.redirectUris,
    grantTypes,
    tokenEndpointAuthMethod: authMethod,
    scope: opts.scope ?? OAUTH_SCOPE,
    createdAt: new Date().toISOString(),
  };
}

export async function getClient(clientId: string | null | undefined): Promise<OAuthClient | null> {
  if (!clientId) return null;
  await ensureOAuthTables();
  const rows = await query<{
    client_id: string;
    client_name: string | null;
    redirect_uris: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
    scope: string | null;
    created_at: string;
  }>(
    `SELECT client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method, scope, created_at
       FROM oauth_clients WHERE client_id = $1 LIMIT 1`,
    [clientId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    clientId: r.client_id,
    clientName: r.client_name,
    redirectUris: r.redirect_uris,
    grantTypes: r.grant_types,
    tokenEndpointAuthMethod: r.token_endpoint_auth_method,
    scope: r.scope,
    createdAt: r.created_at,
  };
}

// ── Authorization codes ─────────────────────────────────────────────────────────
export async function createAuthCode(opts: {
  clientId: string;
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
}): Promise<string> {
  await ensureOAuthTables();
  const raw = randomToken(CODE_PREFIX);
  await query(
    `INSERT INTO oauth_auth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 || ' seconds')::interval)`,
    [
      hash(raw),
      opts.clientId,
      opts.userId,
      opts.redirectUri,
      opts.codeChallenge,
      opts.codeChallengeMethod,
      opts.scope,
      opts.resource,
      String(AUTH_CODE_TTL_SECONDS),
    ],
  );
  return raw;
}

export interface ConsumedAuthCode {
  clientId: string;
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
}

// Atomically consume a code exactly once. Returns null if unknown, expired, or
// already used.
export async function consumeAuthCode(rawCode: string | undefined): Promise<ConsumedAuthCode | null> {
  if (!rawCode || !rawCode.startsWith(CODE_PREFIX)) return null;
  await ensureOAuthTables();
  const codeHash = hash(rawCode);
  return withTransaction(async (tx) => {
    const rows = await tx.query<{
      code_hash: string;
      client_id: string;
      user_id: number;
      redirect_uri: string;
      code_challenge: string;
      code_challenge_method: string;
      scope: string;
      resource: string | null;
    }>(
      `SELECT code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource
         FROM oauth_auth_codes
        WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
        FOR UPDATE`,
      [codeHash],
    );
    if (!rows.length) return null;
    const r = rows[0];
    if (!constantTimeHexEqual(codeHash, r.code_hash)) return null;
    await tx.query(`UPDATE oauth_auth_codes SET consumed_at = NOW() WHERE code_hash = $1`, [codeHash]);
    return {
      clientId: r.client_id,
      userId: r.user_id,
      redirectUri: r.redirect_uri,
      codeChallenge: r.code_challenge,
      codeChallengeMethod: r.code_challenge_method,
      scope: r.scope,
      resource: r.resource,
    };
  });
}

// ── PKCE (S256 only) ────────────────────────────────────────────────────────────
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  // RFC 7636: verifier is 43–128 chars of unreserved ASCII.
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Token issuance ──────────────────────────────────────────────────────────────
export async function issueTokens(opts: {
  userId: number;
  clientId: string;
  scope: string;
  resource: string | null;
}): Promise<IssuedTokens> {
  await ensureOAuthTables();
  const accessRaw = randomToken(ACCESS_PREFIX);
  const refreshRaw = randomToken(REFRESH_PREFIX);
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO oauth_access_tokens (token_hash, user_id, client_id, scope, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)`,
      [hash(accessRaw), opts.userId, opts.clientId, opts.scope, opts.resource, String(ACCESS_TOKEN_TTL_SECONDS)],
    );
    await tx.query(
      `INSERT INTO oauth_refresh_tokens (token_hash, user_id, client_id, scope, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)`,
      [hash(refreshRaw), opts.userId, opts.clientId, opts.scope, opts.resource, String(REFRESH_TOKEN_TTL_SECONDS)],
    );
  });
  return {
    access_token: accessRaw,
    refresh_token: refreshRaw,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: opts.scope,
  };
}

// Rotate a refresh token: revoke the presented one and mint a fresh pair, but
// only if the underlying user is still an active admin/tl. Returns null if the
// refresh token is unknown/expired/revoked or the user is no longer eligible.
export async function rotateRefreshToken(
  rawRefresh: string | undefined,
  clientId: string | null,
): Promise<IssuedTokens | null> {
  if (!rawRefresh || !rawRefresh.startsWith(REFRESH_PREFIX)) return null;
  await ensureOAuthTables();
  const refreshHash = hash(rawRefresh);

  const grant = await withTransaction(async (tx) => {
    const rows = await tx.query<{
      token_hash: string;
      user_id: number;
      client_id: string;
      scope: string;
      resource: string | null;
      role: string;
      status: string;
    }>(
      `SELECT rt.token_hash, rt.user_id, rt.client_id, rt.scope, rt.resource, u.role, u.status
         FROM oauth_refresh_tokens rt
         JOIN users u ON u.user_id = rt.user_id
        WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
        FOR UPDATE`,
      [refreshHash],
    );
    if (!rows.length) return null;
    const r = rows[0];
    if (!constantTimeHexEqual(refreshHash, r.token_hash)) return null;
    // The token must have been issued to the client presenting it.
    if (clientId && r.client_id !== clientId) return null;
    if (r.status !== 'active') return null;
    if (!MCP_ALLOWED_ROLES.includes(r.role as (typeof MCP_ALLOWED_ROLES)[number])) return null;
    // Rotate: revoke the presented refresh token.
    await tx.query(`UPDATE oauth_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [refreshHash]);
    return { userId: r.user_id, clientId: r.client_id, scope: r.scope, resource: r.resource };
  });

  if (!grant) return null;
  return issueTokens(grant);
}

// ── Access-token verification (called by the MCP endpoint every request) ─────────
export async function verifyAccessToken(raw: string | undefined | null): Promise<AccessTokenContext | null> {
  if (!raw || !raw.startsWith(ACCESS_PREFIX)) return null;
  await ensureOAuthTables();
  const tokenHash = hash(raw.trim());
  const rows = await query<{
    token_hash: string;
    client_id: string;
    scope: string;
    resource: string | null;
    expires_at: string;
    user_id: number;
    email: string;
    name: string;
    role: string;
    status: string;
  }>(
    `SELECT t.token_hash, t.client_id, t.scope, t.resource, t.expires_at,
            u.user_id, u.email, u.name, u.role, u.status
       FROM oauth_access_tokens t
       JOIN users u ON u.user_id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > NOW()
      LIMIT 1`,
    [tokenHash],
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (!constantTimeHexEqual(tokenHash, r.token_hash)) return null;
  if (r.status !== 'active') return null;
  if (!MCP_ALLOWED_ROLES.includes(r.role as (typeof MCP_ALLOWED_ROLES)[number])) return null;

  // Best-effort last-used bump — never block auth on it.
  query(`UPDATE oauth_access_tokens SET last_used_at = NOW() WHERE token_hash = $1`, [tokenHash]).catch(() => {});

  return {
    token: raw,
    clientId: r.client_id,
    scope: r.scope,
    resource: r.resource,
    expiresAt: Math.floor(new Date(r.expires_at).getTime() / 1000),
    user: {
      userId: r.user_id,
      email: r.email,
      name: r.name,
      role: r.role,
      isAdmin: r.role === 'admin',
    },
  };
}

// ── Admin: list / revoke connections ────────────────────────────────────────────
// A "connection" is a (user, client) pair. Listing/revoking at that grain avoids
// exposing token hashes and matches the UI's mental model.
export async function listConnections(): Promise<OAuthConnection[]> {
  await ensureOAuthTables();
  const rows = await query<{
    user_id: number;
    user_email: string;
    user_name: string;
    client_id: string;
    client_name: string | null;
    connected_at: string;
    last_used_at: string | null;
    active_count: string;
  }>(
    `SELECT t.user_id,
            u.email AS user_email,
            u.name  AS user_name,
            t.client_id,
            c.client_name,
            MIN(t.created_at)   AS connected_at,
            MAX(t.last_used_at) AS last_used_at,
            COUNT(*) FILTER (WHERE t.revoked_at IS NULL AND t.expires_at > NOW()) AS active_count
       FROM oauth_access_tokens t
       JOIN users u ON u.user_id = t.user_id
       LEFT JOIN oauth_clients c ON c.client_id = t.client_id
      GROUP BY t.user_id, u.email, u.name, t.client_id, c.client_name
      ORDER BY active_count = 0, MAX(t.last_used_at) DESC NULLS LAST, MIN(t.created_at) DESC`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    clientId: r.client_id,
    clientName: r.client_name,
    connectedAt: r.connected_at,
    lastUsedAt: r.last_used_at,
    active: Number(r.active_count) > 0,
  }));
}

// Revoke every access + refresh token for a (user, client) connection.
export async function revokeConnection(userId: number, clientId: string): Promise<boolean> {
  await ensureOAuthTables();
  return withTransaction(async (tx) => {
    const a = await tx.query<{ token_hash: string }>(
      `UPDATE oauth_access_tokens SET revoked_at = NOW()
        WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL
        RETURNING token_hash`,
      [userId, clientId],
    );
    const r = await tx.query<{ token_hash: string }>(
      `UPDATE oauth_refresh_tokens SET revoked_at = NOW()
        WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL
        RETURNING token_hash`,
      [userId, clientId],
    );
    return a.length + r.length > 0;
  });
}

// ── Consent CSRF token ──────────────────────────────────────────────────────────
// The consent screen is a same-origin POST carrying the OAuth params. To stop a
// forged/auto-submitted approval (CSRF) and param tampering between the GET
// (which renders the page for the authenticated user) and the POST, the page
// embeds an HMAC over the exact params + the logged-in user's email + an expiry,
// keyed by NEXTAUTH_SECRET. Only a genuinely-rendered consent page carries a
// valid token. Format: "<expEpochSecs>.<base64url hmac>".
const CONSENT_TTL_SECONDS = 10 * 60;

export interface ConsentFields {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state: string;
  email: string;
}

function consentSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set');
  return s;
}

function consentBase(f: ConsentFields, exp: number): string {
  // Unit-separator joins so field values can't collide across boundaries.
  return [f.clientId, f.redirectUri, f.codeChallenge, f.scope, f.resource, f.state, f.email, String(exp)].join('\x1f');
}

export function signConsentToken(f: ConsentFields, nowSecs: number): string {
  const exp = nowSecs + CONSENT_TTL_SECONDS;
  const mac = createHmac('sha256', consentSecret()).update(consentBase(f, exp)).digest('base64url');
  return `${exp}.${mac}`;
}

export function verifyConsentToken(token: string | undefined, f: ConsentFields, nowSecs: number): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < nowSecs) return false;
  const expected = createHmac('sha256', consentSecret()).update(consentBase(f, exp)).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Error type ──────────────────────────────────────────────────────────────────
// Carries an OAuth-standard error code so route handlers can render the correct
// error response body (RFC 6749 §5.2 / RFC 7591 §3.2.2).
export class OAuthError extends Error {
  code: string;
  constructor(code: string, description: string) {
    super(description);
    this.name = 'OAuthError';
    this.code = code;
  }
}
