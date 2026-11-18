-- Migration 036: rotating roster. Four types; everyone moves to the next type every Monday.
-- Type 1: Sat+Sun off · Type 2: Thu+Fri off · Type 3: Tue+Wed off · Type 4: Mon+Sun off.
-- A roster_assignments row is an anchor: "on type N in the week of effective_from"; later weeks follow the rotation.
-- Safe to run more than once: the old-pattern clean-up only happens the first time, so re-running never wipes a loaded roster.

-- First run only (the rotates column does not exist yet): the old fixed patterns (Sun-Thu / Mon-Fri / Tue-Sat)
-- mean nothing under the rotation, so retire them. Load the real roster with the import files afterwards.
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roster_patterns' AND column_name = 'rotates') THEN
    UPDATE roster_assignments
       SET cancelled_at = NOW(), cancel_reason = 'Replaced by the rotating roster'
     WHERE cancelled_at IS NULL;
  END IF;
END
$mig$;

-- rotates = false marks a fixed type that never moves. None are used today; the column stays so one can be added later.
ALTER TABLE roster_patterns ADD COLUMN IF NOT EXISTS rotates BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO roster_patterns (id, label, off_weekdays, rotates) VALUES
  (1, 'Saturday and Sunday off',   '{6,0}', TRUE),
  (2, 'Thursday and Friday off',   '{4,5}', TRUE),
  (3, 'Tuesday and Wednesday off', '{2,3}', TRUE),
  (4, 'Monday and Sunday off',     '{1,0}', TRUE)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, off_weekdays = EXCLUDED.off_weekdays, rotates = EXCLUDED.rotates;

-- An earlier draft had a fifth "fixed Mon-Fri" type. Remove it if nothing ever used it (if something did, the roster
-- page simply doesn't offer it).
DELETE FROM roster_patterns WHERE id = 5 AND NOT EXISTS (SELECT 1 FROM roster_assignments WHERE pattern_id = 5);
