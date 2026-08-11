-- Migration 013: Identity layer — users, identity_audit, signup_tokens
--
-- Replaces the config.users JSON blob as the source of truth for staff
-- identity. See docs / PRD "Authentication, User Lifecycle & Access
-- Management" for the full design. Additive only — does not touch or drop
-- any existing table, so it is safe to ship ahead of the backfill.

-- ── users ───────────────────────────────────────────────────────────────────
-- user_id is a 4-digit canonical identifier used everywhere, including
-- agent attribution (see agents.user_id below). Starts at 1000, capped at
-- 9999 (MAXVALUE) so an overflow raises an error instead of silently
-- growing to 5 digits.
CREATE SEQUENCE IF NOT EXISTS users_user_id_seq
  START WITH 1000
  MINVALUE 1000
  MAXVALUE 9999
  NO CYCLE;

CREATE TABLE IF NOT EXISTS users (
  user_id             INTEGER PRIMARY KEY DEFAULT nextval('users_user_id_seq')
                        CHECK (user_id BETWEEN 1000 AND 9999),
  email               VARCHAR(255) NOT NULL UNIQUE,
  name                VARCHAR(255) NOT NULL UNIQUE,
  password_hash       TEXT,                          -- null until signup completes
  role                VARCHAR(10) NOT NULL CHECK (role IN ('agent', 'quality', 'tl', 'admin')),
  status              VARCHAR(10) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  assigned_dispositions TEXT[],
  last_login          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          VARCHAR(255) NOT NULL,          -- admin email, or 'migration'
  status_changed_at   TIMESTAMPTZ,
  status_changed_by   VARCHAR(255),
  google_sub          VARCHAR(255) UNIQUE              -- reserved for later SSO phase
);

ALTER SEQUENCE users_user_id_seq OWNED BY users.user_id;

CREATE INDEX IF NOT EXISTS idx_users_email  ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_name   ON users (name);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

-- ── agents.user_id — link agent identity to the users table ────────────────
-- Populated by exact name match during backfill (see scripts/backfill-users.ts).
-- Historical conversation/call rows keep FK-ing agents.id — this link makes
-- `users` the origin of identity going forward without rewriting history.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents (user_id);

-- ── identity_audit — append-only trail of identity events ──────────────────
CREATE TABLE IF NOT EXISTS identity_audit (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_email   VARCHAR(255),                          -- null for system-initiated events
  action        VARCHAR(30) NOT NULL CHECK (action IN (
                  'invite', 'resend_invite', 'signup_completed',
                  'login_success', 'login_fail',
                  'role_change', 'status_change',
                  'signup_link_expired'
                )),
  target_email  VARCHAR(255),
  detail        JSONB
);

CREATE INDEX IF NOT EXISTS idx_identity_audit_target ON identity_audit (target_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_identity_audit_action ON identity_audit (action, ts DESC);

-- ── signup_tokens — single-use, 15-day, email-bound signup/invite links ────
CREATE TABLE IF NOT EXISTS signup_tokens (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,                 -- snapshot; compared against users.email at consume time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signup_tokens_user ON signup_tokens (user_id);

-- ── unassigned_agent_names — webhook agent_name values with no exact user match ─
-- Swept by the backfill/link pass once a matching user is provisioned.
CREATE TABLE IF NOT EXISTS unassigned_agent_names (
  agent_name    VARCHAR(255) PRIMARY KEY,              -- normalized form
  agent_id      INTEGER REFERENCES agents(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrences   INTEGER NOT NULL DEFAULT 1
);
