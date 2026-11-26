-- Migration 038: leave engine, release 1 (leave on the Roster).
-- Per-day leave lines, an append-only balance ledger, holidays and a few settings. Applying and approving come in release 2.
-- Safe to run more than once. Apply by hand (Neon SQL editor) after 035-037.

-- ── one row per leave request (all 11 statuses from the rules doc, so later releases don't rewrite this) ──
CREATE SEQUENCE IF NOT EXISTS leave_id_seq START WITH 10001;
CREATE TABLE IF NOT EXISTS leave_requests (
  leave_id           VARCHAR(20) PRIMARY KEY,                   -- 'LV-10452'
  user_id            INTEGER NOT NULL REFERENCES users(user_id),
  type               VARCHAR(8) NOT NULL CHECK (type IN ('leave', 'lop', 'extra')),
  status             VARCHAR(24) NOT NULL CHECK (status IN (
                       'Applied', 'In process', 'Pending for approval', 'Approved', 'Auto-approved', 'Rejected',
                       'Auto-rejected', 'Auto-cancelled', 'Cancelled', 'Cancelled (exit)', 'Taken')),
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason             TEXT,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL CHECK (end_date >= start_date),
  -- which part of the first and last day is covered: a block can start on the second half and end on the first half
  start_half         VARCHAR(6) NOT NULL DEFAULT 'full' CHECK (start_half IN ('full', 'first', 'second')),
  end_half           VARCHAR(6) NOT NULL DEFAULT 'full' CHECK (end_half IN ('full', 'first', 'second')),
  decided_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  source             VARCHAR(12) NOT NULL DEFAULT 'app'          -- 'import' for the go-live load
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests (user_id, start_date);

-- ── one line per charged day. Week-offs inside a block have no line. A day can hold a leave part and an LOP part. ──
CREATE TABLE IF NOT EXISTS leave_days (
  leave_id VARCHAR(20) NOT NULL REFERENCES leave_requests(leave_id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  kind     VARCHAR(5) NOT NULL CHECK (kind IN ('leave', 'lop')),
  half     VARCHAR(6) NOT NULL DEFAULT 'full' CHECK (half IN ('full', 'first', 'second')),   -- the part of the day the request covers
  state    VARCHAR(10) NOT NULL DEFAULT 'upcoming' CHECK (state IN ('upcoming', 'taken', 'cancelled')),
  charge   NUMERIC(4, 2) NOT NULL CHECK (charge > 0 AND charge <= 1),                          -- quarter days
  PRIMARY KEY (leave_id, day, kind)
);
CREATE INDEX IF NOT EXISTS idx_leave_days_day ON leave_days (day) WHERE state <> 'cancelled';

-- ── the balance: append-only, balance = SUM(amount). Mistakes are fixed with a new line. LOP lines carry 0. ──
CREATE TABLE IF NOT EXISTS leave_ledger (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(user_id),
  entry_type         VARCHAR(40) NOT NULL,       -- Opening balance, Leave approved, Pattern change recalculation, ...
  amount             NUMERIC(6, 2) NOT NULL,     -- signed, quarter days
  leave_id           VARCHAR(20) REFERENCES leave_requests(leave_id) ON DELETE SET NULL,
  description        TEXT NOT NULL,
  entry_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payroll_month      DATE,                       -- first day of the payroll month it lands in (filled when payroll is built)
  created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_user ON leave_ledger (user_id, entry_at, id);

CREATE OR REPLACE FUNCTION leave_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'leave_ledger is append-only: add a correcting line instead';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_leave_ledger_append_only ON leave_ledger;
CREATE TRIGGER trg_leave_ledger_append_only BEFORE UPDATE OR DELETE ON leave_ledger
  FOR EACH ROW EXECUTE FUNCTION leave_ledger_append_only();

-- ── holidays and settings (rules live in Postgres, every change is written to hrms_audit) ──
CREATE TABLE IF NOT EXISTS holidays (
  day                DATE PRIMARY KEY,
  name               VARCHAR(120) NOT NULL,
  created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS leave_settings (
  key                VARCHAR(60) PRIMARY KEY,
  value              TEXT NOT NULL,
  updated_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO leave_settings (key, value) VALUES ('negative_limit', '-2') ON CONFLICT (key) DO NOTHING;
