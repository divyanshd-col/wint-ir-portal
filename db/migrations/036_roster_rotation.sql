-- Migration 036: rotating roster. Four types; everyone moves to the next type every Monday.
-- Type 1: Sat+Sun off · Type 2: Thu+Fri off · Type 3: Tue+Wed off · Type 4: Mon+Sun off.
-- A roster_assignments row is now an anchor: "on type N in the week of effective_from"; later weeks follow the rotation.
-- Safe to run more than once. Apply by hand: node scripts/apply-036-roster-rotation.mjs

-- rotates = false: a fixed type that stays the same every week (the Mon-Fri team).
ALTER TABLE roster_patterns ADD COLUMN IF NOT EXISTS rotates BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO roster_patterns (id, label, off_weekdays, rotates) VALUES
  (1, 'Saturday and Sunday off',          '{6,0}', TRUE),
  (2, 'Thursday and Friday off',          '{4,5}', TRUE),
  (3, 'Tuesday and Wednesday off',        '{2,3}', TRUE),
  (4, 'Monday and Sunday off',            '{1,0}', TRUE),
  (5, 'Monday to Friday (fixed, no rotation)', '{6,0}', FALSE)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, off_weekdays = EXCLUDED.off_weekdays, rotates = EXCLUDED.rotates;

-- Old fixed patterns (Sun-Thu / Mon-Fri / Tue-Sat) mean nothing under the rotation: retire them.
-- Load the real roster with scripts/import-roster.mjs.
UPDATE roster_assignments
   SET cancelled_at = NOW(), cancel_reason = 'Replaced by the rotating roster'
 WHERE cancelled_at IS NULL;
