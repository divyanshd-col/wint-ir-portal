-- Backfill call_recordings.duration_seconds from the transcript's last timestamp ("m:ss" or "h:mm:ss").
-- Only touches rows with no duration. Check the preview first (change UPDATE to the SELECT below), then run the UPDATE.
-- SELECT count(*) FROM call_recordings cr, LATERAL (<same subquery>) ... -- or simply wrap in BEGIN; ...; ROLLBACK; to preview.
UPDATE call_recordings cr
SET duration_seconds = x.secs, updated_at = NOW()
FROM (
  SELECT c.id,
         MAX(CASE
               WHEN s->>'ts' ~ '^\d+:\d{2}:\d{2}$' THEN split_part(s->>'ts', ':', 1)::int * 3600 + split_part(s->>'ts', ':', 2)::int * 60 + split_part(s->>'ts', ':', 3)::int
               WHEN s->>'ts' ~ '^\d{1,3}:\d{2}$'   THEN split_part(s->>'ts', ':', 1)::int * 60 + split_part(s->>'ts', ':', 2)::int
             END) AS secs
  FROM call_recordings c, jsonb_array_elements(c.transcript) s
  WHERE c.duration_seconds IS NULL AND jsonb_typeof(c.transcript) = 'array'
  GROUP BY c.id
) x
WHERE cr.id = x.id AND x.secs > 0;
