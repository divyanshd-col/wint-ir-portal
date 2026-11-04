-- Migration 035: Roster (Phase A) — dated weekly patterns, reporting lines, extra-day marks, work channels.
-- Additive only. Apply by hand: node scripts/apply-035-roster.mjs

-- ── patterns: data, not code constants ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS roster_patterns (
  id           SMALLINT PRIMARY KEY,
  label        VARCHAR(60) NOT NULL,
  off_weekdays SMALLINT[]  NOT NULL            -- 0 = Sunday … 6 = Saturday
);
INSERT INTO roster_patterns (id, label, off_weekdays) VALUES
  (1, 'Sunday to Thursday', '{5,6}'),
  (2, 'Monday to Friday',   '{6,0}'),
  (3, 'Tuesday to Saturday','{0,1}')
ON CONFLICT (id) DO NOTHING;

-- ── dated pattern assignments. A scheduled change is a row dated in the future. ──
CREATE TABLE IF NOT EXISTS roster_assignments (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              INTEGER  NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  pattern_id           SMALLINT NOT NULL REFERENCES roster_patterns(id),
  effective_from       DATE     NOT NULL,
  reason               TEXT     NOT NULL,
  set_by_user_id       INTEGER  REFERENCES users(user_id) ON DELETE SET NULL,
  set_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at         TIMESTAMPTZ,
  cancelled_by_user_id INTEGER  REFERENCES users(user_id) ON DELETE SET NULL,
  cancel_reason        TEXT
);
CREATE INDEX IF NOT EXISTS idx_roster_assign_user ON roster_assignments (user_id, effective_from DESC);
-- one active row per person per start date
CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_assign_active_day
  ON roster_assignments (user_id, effective_from) WHERE cancelled_at IS NULL;

-- ── reporting lines: TL → member by user id (never by name) ─────────────────
CREATE TABLE IF NOT EXISTS reporting_lines (
  user_id        INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  tl_user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  effective_from DATE    NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_reporting_lines_tl ON reporting_lines (tl_user_id);

-- ── extra day worked marks (Phase A: mark only; approval/credit is Phase B) ─
CREATE TABLE IF NOT EXISTS roster_extra_marks (
  id                BIGSERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day               DATE    NOT NULL,
  half              VARCHAR(6) NOT NULL DEFAULT 'full' CHECK (half IN ('full','first','second')),
  reason            TEXT    NOT NULL,
  status            VARCHAR(12) NOT NULL DEFAULT 'marked',
  marked_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  marked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_extra_active
  ON roster_extra_marks (user_id, day) WHERE reversed_at IS NULL;

-- ── work channels (informational; not permission "skills") ──────────────────
CREATE TABLE IF NOT EXISTS work_channels (
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('Chats','Calls','Emails','ORM')),
  PRIMARY KEY (user_id, channel)
);

-- ── daily limits as data (read by Phase B) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS limits_by_role (
  role    VARCHAR(10) NOT NULL,
  weekday SMALLINT    NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  half    VARCHAR(6)  NOT NULL CHECK (half IN ('first','second')),
  max_off INTEGER     NOT NULL,
  PRIMARY KEY (role, weekday, half)
);
INSERT INTO limits_by_role (role, weekday, half, max_off)
SELECT r.role, d.d, h.h, CASE WHEN r.role = 'tl' THEN 1 WHEN d.d IN (0,6) THEN 3 ELSE 5 END
FROM (VALUES ('tl'),('agent')) r(role), generate_series(0,6) d(d), (VALUES ('first'),('second')) h(h)
ON CONFLICT DO NOTHING;

-- ── shared HRMS audit (actor by user id) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms_audit (
  id             BIGSERIAL PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  action         VARCHAR(40) NOT NULL,
  target_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  detail         JSONB
);
CREATE INDEX IF NOT EXISTS idx_hrms_audit_target ON hrms_audit (target_user_id, ts DESC);

-- ── permissions (DB side of SBAC) ───────────────────────────────────────────
INSERT INTO skills (id, name, description, category) VALUES
  ('roster:view:access',   'View Roster',   'View the roster grid, scheduled changes and work channels.', 'Roster'),
  ('roster:manage:access', 'Manage Roster', 'Change weekly patterns, mark extra days and edit work channels for people in scope.', 'Roster')
ON CONFLICT (id) DO NOTHING;
INSERT INTO persona_skills (persona_id, skill_id, assigned_by) VALUES
  ('admin','roster:view:access','system'),('admin','roster:manage:access','system'),
  ('tl','roster:view:access','system'),('tl','roster:manage:access','system'),
  ('quality','roster:view:access','system'),('agent','roster:view:access','system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;

-- ── initial pattern for everyone: Monday to Friday from 1 Jan 2026 ─────────
INSERT INTO roster_assignments (user_id, pattern_id, effective_from, reason)
SELECT u.user_id, 2, DATE '2026-01-01', 'Initial pattern'
FROM users u WHERE u.role IN ('agent','tl') AND u.platform_domain <> 'pcg'  -- Wint CX team only
ON CONFLICT DO NOTHING;

-- ── seed reporting lines by EXACT, unambiguous name match only ─────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'tl_name') THEN
    INSERT INTO reporting_lines (user_id, tl_user_id, effective_from)
    SELECT DISTINCT a.user_id, t.user_id, DATE '2026-01-01'
    FROM agents a
    JOIN users t ON t.role = 'tl' AND t.name = a.tl_name
    WHERE a.user_id IS NOT NULL
      AND (SELECT COUNT(*) FROM users x WHERE x.role = 'tl' AND x.name = a.tl_name) = 1
      AND (SELECT COUNT(DISTINCT a2.tl_name) FROM agents a2 WHERE a2.user_id = a.user_id AND a2.tl_name IS NOT NULL) = 1
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
