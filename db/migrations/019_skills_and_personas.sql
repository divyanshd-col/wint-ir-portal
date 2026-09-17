-- Migration 019: Skill-Based Access Control (SBAC) - skills, personas, persona_skills, user_skills
--
-- Decouples feature permissions from static role strings. Each capability is
-- treated as a distinct "skill" that can be attached to or detached from any User Persona.

CREATE TABLE IF NOT EXISTS skills (
  id          VARCHAR(60) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  category    VARCHAR(50) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personas (
  id          VARCHAR(50) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS persona_skills (
  persona_id  VARCHAR(50) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  skill_id    VARCHAR(60) NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by VARCHAR(255),
  PRIMARY KEY (persona_id, skill_id)
);

CREATE TABLE IF NOT EXISTS user_skills (
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  skill_id    VARCHAR(60) NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  granted     BOOLEAN NOT NULL DEFAULT true,
  assigned_by VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_persona_skills_persona ON persona_skills (persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_skills_skill   ON persona_skills (skill_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_user       ON user_skills (user_id);

-- Widen identity_audit.action constraint to include 'skill_change'
ALTER TABLE identity_audit DROP CONSTRAINT IF EXISTS identity_audit_action_check;
ALTER TABLE identity_audit ADD CONSTRAINT identity_audit_action_check
  CHECK (action IN (
    'invite', 'resend_invite', 'signup_completed',
    'login_success', 'login_fail',
    'role_change', 'status_change',
    'signup_link_expired',
    'name_change', 'email_change',
    'skill_change'
  ));

-- ── Seed Personas ─────────────────────────────────────────────────────────────
INSERT INTO personas (id, name, description, is_system)
VALUES
  ('admin',   'Administrator', 'Full system access, skill and user management, system settings, and all portal tools.', true),
  ('tl',      'Team Lead',     'Team and member supervision, chat and call quality reviews, dispute handling, and analytics.', true),
  ('quality', 'QA Reviewer',   'Specialized in evaluating agent chat and call quality, scorecards, and disposition auditing.', true),
  ('agent',   'IR Agent',      'Customer relationship management, copilot assistant, self-performance tracking, and disputes.', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- ── Seed Skills ───────────────────────────────────────────────────────────────
INSERT INTO skills (id, name, description, category)
VALUES
  -- Core & Chat
  ('chat:access',               'IR Assistant Chat',        'Access to the conversational IR copilot and messaging workspace.',           'Core'),

  -- Analytics
  ('analytics:access',          'Executive Analytics',      'Access to natural language AI analytics queries and SQL synthesis.',        'Analytics'),
  ('call_analysis:access',       'Call Audio Analysis',      'Access to audio call transcription, speaker diarization, and call metrics.','Analytics'),
  ('cx_dashboard:access',       'CX Performance Dashboard', 'Access to cross-functional customer experience overview dashboards.',       'Analytics'),

  -- Quality Tool & Reviews
  ('quality:analytics:access',   'Quality Overview',         'Access to overall quality analytics, IQS distributions, and agent metrics.','Quality Tool'),
  ('quality:chat_eval:access',   'Chat Evaluation',          'Perform manual reviews, scorecards, and parameter overrides on chats.',    'Quality Tool'),
  ('quality:call_eval:access',   'Call Evaluation',          'Perform manual reviews, scorecards, and parameter overrides on calls.',    'Quality Tool'),

  -- Team Lead Supervision
  ('tl:team_analytics:access',   'TL Team Analytics',        'View aggregated performance, trendlines, and benchmarks for team members.', 'Team Lead'),
  ('tl:member_analytics:access', 'TL Member Analytics',      'Deep dive into individual agent performance, scores, and coaching notes.',  'Team Lead'),
  ('tl:quality_chats:access',    'TL Quality Chats',         'Supervise team chat audits, resolve agent disputes, or forward to QA.',     'Team Lead'),
  ('tl:quality_calls:access',    'TL Quality Calls',         'Supervise team call audits, resolve agent disputes, or forward to QA.',     'Team Lead'),
  ('tl:reports:access',          'TL IR Reports',            'Generate and manage daily/weekly operational performance reports for team.','Team Lead'),

  -- Agent Operations
  ('agent:my_analytics:access',  'Agent My Analytics',       'View personal analytics, scorecard trends, and feedback insights.',        'Agent'),
  ('agent:my_chats:access',      'Agent My Quality Chats',   'Review own audited chats, score breakdowns, and raise disputes.',           'Agent'),
  ('agent:my_calls:access',      'Agent My Quality Calls',   'Review own audited calls, audio playback, and raise disputes.',             'Agent'),
  ('agent:reports:access',       'Agent My Reports',         'Access and view personal weekly/daily performance scorecards.',             'Agent'),

  -- Administration
  ('tokens:view:access',         'Token Usage Monitor',      'Monitor LLM token consumption, provider breakdowns, and cost metrics.',    'Administration'),
  ('settings:manage:access',     'System Settings',          'Configure API keys, AI model prompts, and knowledge base documents.',       'Administration'),
  ('users:manage:access',        'User & Team Management',   'Invite users, edit profiles, map team hierarchies, and route QA disps.',    'Administration'),
  ('skills:manage:access',       'Skills & Permissions',     'Configure, assign, and toggle skill permissions for user personas.',        'Administration')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

-- ── Seed Default Persona Skills ───────────────────────────────────────────────

-- Admin gets all skills
INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
SELECT 'admin', id, 'system' FROM skills
ON CONFLICT (persona_id, skill_id) DO NOTHING;

-- Team Lead (TL) defaults
INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
VALUES
  ('tl', 'chat:access',               'system'),
  ('tl', 'analytics:access',          'system'),
  ('tl', 'call_analysis:access',       'system'),
  ('tl', 'cx_dashboard:access',       'system'),
  ('tl', 'quality:analytics:access',   'system'),
  ('tl', 'tl:team_analytics:access',   'system'),
  ('tl', 'tl:member_analytics:access', 'system'),
  ('tl', 'tl:quality_chats:access',    'system'),
  ('tl', 'tl:quality_calls:access',    'system'),
  ('tl', 'tl:reports:access',          'system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;

-- QA Reviewer (Quality) defaults
INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
VALUES
  ('quality', 'chat:access',             'system'),
  ('quality', 'cx_dashboard:access',     'system'),
  ('quality', 'quality:analytics:access', 'system'),
  ('quality', 'quality:chat_eval:access', 'system'),
  ('quality', 'quality:call_eval:access', 'system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;

-- IR Agent defaults
INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
VALUES
  ('agent', 'chat:access',              'system'),
  ('agent', 'quality:analytics:access',  'system'),
  ('agent', 'agent:my_analytics:access', 'system'),
  ('agent', 'agent:my_chats:access',     'system'),
  ('agent', 'agent:my_calls:access',     'system'),
  ('agent', 'agent:reports:access',      'system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;
