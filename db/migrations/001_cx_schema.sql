-- teams
CREATE TABLE IF NOT EXISTS cx_teams (
  team_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name  VARCHAR(255) NOT NULL,
  tl_id      UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users (CX users, separate from portal users)
CREATE TABLE IF NOT EXISTS cx_users (
  user_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('admin','tl','qa','agent')),
  agent_id   UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- agents
CREATE TABLE IF NOT EXISTS cx_agents (
  agent_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES cx_users(user_id),
  team_id    UUID NOT NULL REFERENCES cx_teams(team_id),
  qa_id      UUID NOT NULL REFERENCES cx_users(user_id),
  status     VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- qa_audits
CREATE TABLE IF NOT EXISTS cx_qa_audits (
  audit_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES cx_agents(agent_id),
  qa_id      UUID NOT NULL REFERENCES cx_users(user_id),
  score      NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  audited_at TIMESTAMPTZ NOT NULL,
  week_start DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_audits_agent_week ON cx_qa_audits(agent_id, week_start);

-- csat_responses
CREATE TABLE IF NOT EXISTS cx_csat_responses (
  response_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES cx_agents(agent_id),
  rating       SMALLINT NOT NULL CHECK (rating IN (1,3,5)),
  responded_at TIMESTAMPTZ NOT NULL,
  week_start   DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csat_agent_week ON cx_csat_responses(agent_id, week_start);

-- tickets
CREATE TABLE IF NOT EXISTS cx_tickets (
  ticket_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES cx_agents(agent_id),
  resolved_at TIMESTAMPTZ NOT NULL,
  week_start  DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_agent_week ON cx_tickets(agent_id, week_start);

-- Trigger function to compute week_start (Monday of ISO week)
CREATE OR REPLACE FUNCTION cx_compute_week_start()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'cx_qa_audits' THEN
    NEW.week_start := date_trunc('week', NEW.audited_at AT TIME ZONE 'UTC')::DATE;
  ELSIF TG_TABLE_NAME = 'cx_csat_responses' THEN
    NEW.week_start := date_trunc('week', NEW.responded_at AT TIME ZONE 'UTC')::DATE;
  ELSIF TG_TABLE_NAME = 'cx_tickets' THEN
    NEW.week_start := date_trunc('week', NEW.resolved_at AT TIME ZONE 'UTC')::DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_qa_audits_week_start ON cx_qa_audits;
CREATE TRIGGER trg_qa_audits_week_start
  BEFORE INSERT OR UPDATE ON cx_qa_audits
  FOR EACH ROW EXECUTE FUNCTION cx_compute_week_start();

DROP TRIGGER IF EXISTS trg_csat_week_start ON cx_csat_responses;
CREATE TRIGGER trg_csat_week_start
  BEFORE INSERT OR UPDATE ON cx_csat_responses
  FOR EACH ROW EXECUTE FUNCTION cx_compute_week_start();

DROP TRIGGER IF EXISTS trg_tickets_week_start ON cx_tickets;
CREATE TRIGGER trg_tickets_week_start
  BEFORE INSERT OR UPDATE ON cx_tickets
  FOR EACH ROW EXECUTE FUNCTION cx_compute_week_start();
