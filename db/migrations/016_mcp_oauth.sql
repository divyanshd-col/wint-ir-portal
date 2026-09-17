-- Migration 016: OAuth 2.1 authorization-server tables for the Analytics MCP.
--
-- claude.ai's web connector authenticates via OAuth (RFC 8414 discovery +
-- RFC 7591 Dynamic Client Registration + authorization-code/PKCE), not the
-- static bearer tokens from migration 015. These tables back the hand-rolled
-- authorization server in lib/mcp/oauth.ts:
--
--   oauth_clients         — dynamically-registered clients (public, PKCE-only).
--   oauth_auth_codes      — one-time authorization codes, PKCE-bound.
--   oauth_access_tokens   — bearer tokens presented to the MCP endpoint.
--   oauth_refresh_tokens  — long-lived, rotating refresh tokens.
--
-- Only SHA-256 hashes of codes/tokens are stored — the raw values live only in
-- the client (claude.ai). Everything is additive and self-heals via
-- ensureOAuthTables() (CREATE TABLE IF NOT EXISTS), matching migration 015.

-- ── Registered OAuth clients (RFC 7591 Dynamic Client Registration) ────────────
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                   TEXT PRIMARY KEY,            -- opaque, server-generated
  client_name                 VARCHAR(255),                -- from registration metadata (untrusted)
  redirect_uris               TEXT[] NOT NULL,             -- exact-match allowlist for this client
  grant_types                 TEXT[] NOT NULL DEFAULT ARRAY['authorization_code','refresh_token'],
  token_endpoint_auth_method  VARCHAR(40) NOT NULL DEFAULT 'none',  -- public client → PKCE only
  scope                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Authorization codes (short-lived, one-time, PKCE-bound) ────────────────────
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash             TEXT PRIMARY KEY,                  -- sha256(raw code), hex
  client_id             TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id               INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,                     -- must match on token exchange
  code_challenge        TEXT NOT NULL,                     -- PKCE (S256)
  code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',
  scope                 TEXT NOT NULL,
  resource              TEXT,                              -- RFC 8707 resource indicator
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,                       -- set on first (only) use
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expiry ON oauth_auth_codes (expires_at);

-- ── Access tokens (presented to the MCP endpoint on every request) ─────────────
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash    TEXT PRIMARY KEY,                          -- sha256(raw token), hex
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  resource      TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user   ON oauth_access_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_active ON oauth_access_tokens (token_hash) WHERE revoked_at IS NULL;

-- ── Refresh tokens (rotating; one live token per connection) ───────────────────
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash    TEXT PRIMARY KEY,                          -- sha256(raw token), hex
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  resource      TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,                               -- set when rotated or revoked
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_user   ON oauth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_active ON oauth_refresh_tokens (token_hash) WHERE revoked_at IS NULL;
