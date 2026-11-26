-- Migration 037: the Roster is off for agents for now.
-- It is an ordinary skill, so it can be switched back on without a deploy: in the app, Settings > Skills, give the
-- Agent persona "View Roster" (roster:view:access). Or in SQL:
--   INSERT INTO persona_skills (persona_id, skill_id, assigned_by) VALUES ('agent', 'roster:view:access', 'admin') ON CONFLICT DO NOTHING;
-- People logged in need to sign out and back in to see the change.
DELETE FROM persona_skills WHERE persona_id = 'agent' AND skill_id = 'roster:view:access';
