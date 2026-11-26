-- Migration 039: leave engine, release 2 core (apply, the 5-minute window, decisions, approvals, notifications).
-- Safe to run more than once. Apply by hand (Neon SQL editor) after 038.

-- ── what a request needs to be decided, held and tracked ──
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS window_ends_at  TIMESTAMPTZ,                       -- applied_at + 5 minutes, restarted by an edit
  ADD COLUMN IF NOT EXISTS with_level      VARCHAR(5) CHECK (with_level IN ('tl', 'admin')),   -- who it is with while it waits
  ADD COLUMN IF NOT EXISTS with_since      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_code     VARCHAR(12) CHECK (reject_code IN ('short_notice', 'full', 'too_long')),
  ADD COLUMN IF NOT EXISTS reject_note     TEXT,                               -- "4 people are already off that day"
  ADD COLUMN IF NOT EXISTS cancel_deadline TIMESTAMPTZ,                        -- 11:59 pm IST on the day it was auto-rejected
  ADD COLUMN IF NOT EXISTS holds_spot      BOOLEAN NOT NULL DEFAULT TRUE,      -- false for a full-day rejection until someone approves it
  ADD COLUMN IF NOT EXISTS sent_to_tl      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stretch_days    INTEGER,                            -- days away in a row when it was decided
  ADD COLUMN IF NOT EXISTS decided_at      TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leave_requests_due ON leave_requests (window_ends_at) WHERE status = 'In process';
CREATE INDEX IF NOT EXISTS idx_leave_requests_waiting ON leave_requests (with_level, with_since) WHERE status = 'Pending for approval';

-- ── every action on a request, for its timeline (who, when, what, why) ──
CREATE TABLE IF NOT EXISTS leave_events (
  id            BIGSERIAL PRIMARY KEY,
  leave_id      VARCHAR(20) NOT NULL REFERENCES leave_requests(leave_id) ON DELETE CASCADE,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,   -- NULL = the system
  event         VARCHAR(30) NOT NULL,
  text          TEXT NOT NULL,
  reason        TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_events_leave ON leave_events (leave_id, at, id);

-- ── in-app notifications (the bell) ──
CREATE TABLE IF NOT EXISTS notifications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  text         TEXT NOT NULL,
  leave_id     VARCHAR(20) REFERENCES leave_requests(leave_id) ON DELETE SET NULL,
  read_at      TIMESTAMPTZ,
  needs_ack    BOOLEAN NOT NULL DEFAULT FALSE,      -- a team member cancelled: the TL clicks Okay
  acked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- ── permissions. The leave pages are OFF for everyone but admins until you switch them on ──
-- To open them: Settings > Skills, give a persona "Use Leave" (leave:use:access).
INSERT INTO skills (id, name, description, category) VALUES
  ('leave:use:access',     'Use Leave',     'Apply for leave, see own requests, balance and statement.', 'Leave'),
  ('leave:approve:access', 'Approve Leave', 'Approve, reject or forward leave requests (a TL for their own team, an admin for everyone).', 'Leave')
ON CONFLICT (id) DO NOTHING;
INSERT INTO persona_skills (persona_id, skill_id, assigned_by) VALUES
  ('admin', 'leave:use:access', 'system'), ('admin', 'leave:approve:access', 'system'),
  ('tl', 'leave:approve:access', 'system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;

-- ── rules (numbers come from you; see leave_settings keys below). Apply stays closed until all are set. ──
-- threshold_1        days away in a row up to which the system approves by itself
-- threshold_2        above this, only an admin can approve
-- max_length         above this the request is auto-rejected (it can still be sent up)
-- notice_band_1_length / notice_band_1_days     up to this many days away: this many days of notice
-- notice_band_2_length / notice_band_2_days
-- notice_band_3_days                            longer than band 2: this many days of notice
-- reminder_days      calendar days a request may wait before it is reminded and moved up (release 2b)
