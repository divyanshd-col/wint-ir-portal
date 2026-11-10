-- 035_restore_team_analytics_for_tl.sql
-- Give Team Leads Team Analytics again (reverses 027). The API scopes a TL to their own team's agents.

INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
VALUES ('tl', 'tl:team_analytics:access', 'system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;
