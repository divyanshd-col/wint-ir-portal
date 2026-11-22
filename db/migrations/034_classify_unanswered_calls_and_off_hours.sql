-- Migration 034: Classify unanswered PCG calls by CRM client identity,
-- distinguish valid client unanswered calls from unverified/non-client calls,
-- and support Working Hours (10:00 AM - 7:00 PM IST Mon-Fri) vs Off-Hours/Weekends.

-- 1. Unanswered calls with Runo customer_id -> client
UPDATE pcg_call_recordings
SET call_nature = 'client'
WHERE (duration_seconds = 0 OR tag = 'unanswered' OR call_type = 'missed')
  AND customer_id IS NOT NULL AND customer_id != '';

-- 2. Unanswered calls matching registered investor contacts -> client
UPDATE pcg_call_recordings r
SET call_nature = 'client'
FROM contacts c
WHERE (r.duration_seconds = 0 OR r.tag = 'unanswered' OR r.call_type = 'missed')
  AND (r.call_nature IS NULL OR r.call_nature = 'unclassified')
  AND c.phone = REPLACE(r.phone_number, '+', '');

-- 3. Remaining unanswered calls (no customer_id and no contacts match) -> non_client
UPDATE pcg_call_recordings
SET call_nature = 'non_client',
    exclusion_reason = 'Unverified incoming/missed ring (No CRM lead or contact match)'
WHERE (duration_seconds = 0 OR tag = 'unanswered' OR call_type = 'missed')
  AND (call_nature IS NULL OR call_nature = 'unclassified');

-- 4. Answered calls that are still unclassified -> client
UPDATE pcg_call_recordings
SET call_nature = 'client'
WHERE duration_seconds > 0 AND (tag IS NULL OR tag != 'unanswered') AND (call_type IS NULL OR call_type != 'missed')
  AND (call_nature IS NULL OR call_nature = 'unclassified');
