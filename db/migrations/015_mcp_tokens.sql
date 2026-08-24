-- Migration 015: mcp_tokens — bearer tokens for the remote Analytics MCP server.
--
-- The MCP endpoint (app/api/mcp/[transport]/route.ts) is internet-reachable and
-- authenticates with an opaque bearer token instead of the NextAuth browser
-- session. Each token is minted for a specific user (admin/tl) from Settings and
-- can be revoked. Only the SHA-256 hash of the token is stored — the raw token
-- is shown to the admin exactly once at creation time.
--
-- Additive only; safe to ship ahead of use. The token API also creates this
-- table lazily (CREATE TABLE IF NOT EXISTS) so a missed migration self-heals.

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id            BIGSERIAL PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,             -- sha256(raw token), hex
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  label         VARCHAR(120) NOT NULL,            -- human-readable ("CEO — Claude desktop")
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(255) NOT NULL,            -- admin email who minted it
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user    ON mcp_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_active  ON mcp_tokens (token_hash) WHERE revoked_at IS NULL;
