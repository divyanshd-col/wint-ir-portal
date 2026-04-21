-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: Recalculate frt_seconds using auto-assignment timestamp
--
-- Problem: the webhook was only extracting transferTimestamp from "assigned by"
-- messages but Robylon sends "Auto-Assigned chat to <agent>" messages instead.
-- This caused FRT to fall back to first-customer-message → first-agent-message,
-- which includes all bot wait time and is wrong for hybrid chats.
--
-- Fix: find the auto-assigned/assigned-by message in raw_payload, use its
-- timestamp as FRT start, and compute seconds to first agent message in the
-- stored transcript (which already has correct ISO timestamps).
--
-- Run once:  psql $DATABASE_URL -f db/migrations/004_fix_frt_seconds.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper: parse "Apr 21, 10:53 AM" (IST) → timestamptz (UTC) ────────────
CREATE OR REPLACE FUNCTION parse_roby_ts(ts text, yr int)
RETURNS timestamptz AS $$
DECLARE
  parts  text[];
  mon    text;
  dy     int;
  hr     int;
  mn     int;
  ap     text;
  mon_n  int;
BEGIN
  IF ts IS NULL OR ts = '' THEN RETURN NULL; END IF;

  parts := regexp_match(ts, '^(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)$');
  IF parts IS NULL THEN RETURN NULL; END IF;

  mon := parts[1];
  dy  := parts[2]::int;
  hr  := parts[3]::int;
  mn  := parts[4]::int;
  ap  := parts[5];

  mon_n := CASE mon
    WHEN 'Jan' THEN 1  WHEN 'Feb' THEN 2  WHEN 'Mar' THEN 3
    WHEN 'Apr' THEN 4  WHEN 'May' THEN 5  WHEN 'Jun' THEN 6
    WHEN 'Jul' THEN 7  WHEN 'Aug' THEN 8  WHEN 'Sep' THEN 9
    WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
    ELSE NULL
  END;
  IF mon_n IS NULL THEN RETURN NULL; END IF;

  IF ap = 'PM' AND hr <> 12 THEN hr := hr + 12; END IF;
  IF ap = 'AM' AND hr = 12  THEN hr := 0;        END IF;

  -- Build in IST (Asia/Kolkata = UTC+5:30) and return as UTC
  RETURN make_timestamptz(yr, mon_n, dy, hr, mn, 0, 'Asia/Kolkata');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 2. Preview — see what will change before you run the UPDATE ───────────────
-- Uncomment this block to inspect before committing:
/*
SELECT
  c.id,
  c.frt_seconds                       AS frt_old,
  GREATEST(0, EXTRACT(EPOCH FROM (fat.first_agent_ts - at.assign_ts))::int)
                                       AS frt_new,
  at.assign_ts,
  fat.first_agent_ts
FROM conversations c
JOIN LATERAL (
  SELECT parse_roby_ts(
           m->>'timestamp',
           COALESCE(EXTRACT(YEAR FROM c.started_at)::int, 2026)
         ) AS assign_ts
  FROM jsonb_array_elements(
    COALESCE(
      c.raw_payload->'data'->'transcript'->'messages',
      c.raw_payload->'messages',
      '[]'::jsonb
    )
  ) m
  WHERE  LOWER(m->>'content') LIKE '%auto-assigned%'
      OR LOWER(m->>'content') LIKE '%assigned by%'
  ORDER BY assign_ts ASC NULLS LAST
  LIMIT 1
) at ON true
JOIN LATERAL (
  SELECT (m->>'timestamp')::timestamptz AS first_agent_ts
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.transcript) = 'array' THEN c.transcript ELSE '[]'::jsonb END
  ) m
  WHERE m->>'sender_type' = 'agent'
    AND (m->>'timestamp') IS NOT NULL
    AND (m->>'timestamp') <> ''
  ORDER BY (m->>'timestamp')::timestamptz ASC
  LIMIT 1
) fat ON true
WHERE c.raw_payload IS NOT NULL
  AND at.assign_ts IS NOT NULL
  AND fat.first_agent_ts IS NOT NULL
  AND fat.first_agent_ts > at.assign_ts
ORDER BY c.id;
*/

-- ── 3. Apply the fix ──────────────────────────────────────────────────────────
WITH corrected AS (
  SELECT
    c.id,
    GREATEST(0, EXTRACT(EPOCH FROM (fat.first_agent_ts - at.assign_ts))::int) AS frt_new
  FROM conversations c
  JOIN LATERAL (
    SELECT parse_roby_ts(
             m->>'timestamp',
             COALESCE(EXTRACT(YEAR FROM c.started_at)::int, 2026)
           ) AS assign_ts
    FROM jsonb_array_elements(
      COALESCE(
        c.raw_payload->'data'->'transcript'->'messages',
        c.raw_payload->'messages',
        '[]'::jsonb
      )
    ) m
    WHERE  LOWER(m->>'content') LIKE '%auto-assigned%'
        OR LOWER(m->>'content') LIKE '%assigned by%'
    ORDER BY assign_ts ASC NULLS LAST
    LIMIT 1
  ) at ON true
  JOIN LATERAL (
    SELECT (m->>'timestamp')::timestamptz AS first_agent_ts
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.transcript) = 'array' THEN c.transcript ELSE '[]'::jsonb END
    ) m
    WHERE m->>'sender_type' = 'agent'
      AND (m->>'timestamp') IS NOT NULL
      AND (m->>'timestamp') <> ''
    ORDER BY (m->>'timestamp')::timestamptz ASC
    LIMIT 1
  ) fat ON true
  WHERE c.raw_payload IS NOT NULL
    AND at.assign_ts IS NOT NULL
    AND fat.first_agent_ts IS NOT NULL
    AND fat.first_agent_ts > at.assign_ts
)
UPDATE conversations
SET    frt_seconds = corrected.frt_new,
       updated_at  = NOW()
FROM   corrected
WHERE  conversations.id = corrected.id;

-- ── 4. Report ─────────────────────────────────────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE frt_seconds IS NOT NULL) AS chats_with_frt,
  COUNT(*) FILTER (WHERE frt_seconds IS NULL)     AS chats_missing_frt,
  ROUND(AVG(frt_seconds) FILTER (WHERE frt_seconds IS NOT NULL) / 60.0, 1) AS avg_frt_minutes,
  MIN(frt_seconds) FILTER (WHERE frt_seconds IS NOT NULL)                  AS min_frt_seconds,
  MAX(frt_seconds) FILTER (WHERE frt_seconds IS NOT NULL)                  AS max_frt_seconds
FROM conversations;
