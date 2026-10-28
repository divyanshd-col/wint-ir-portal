-- 027_restrict_team_analytics_to_admins.sql
-- Restrict Team Analytics (tl:team_analytics:access) to Administrator persona only.

-- Remove tl:team_analytics:access from Team Lead persona
DELETE FROM persona_skills
WHERE persona_id = 'tl' AND skill_id = 'tl:team_analytics:access';

-- Remove any user overrides granting it to non-admins (if any)
DELETE FROM user_skills
WHERE skill_id = 'tl:team_analytics:access';

-- Ensure admin persona has tl:team_analytics:access
INSERT INTO persona_skills (persona_id, skill_id, assigned_by)
VALUES ('admin', 'tl:team_analytics:access', 'system')
ON CONFLICT (persona_id, skill_id) DO NOTHING;
