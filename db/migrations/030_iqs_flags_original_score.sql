-- Migration 030: Add original_score to iqs_flags to record score at dispute time
ALTER TABLE iqs_flags ADD COLUMN IF NOT EXISTS original_score NUMERIC(5,2);

-- Backfill from chat_review_comparisons for reviewed chats
UPDATE iqs_flags f
SET original_score = c.ai_score
FROM chat_review_comparisons c
WHERE f.chat_id = c.chat_id
  AND f.original_score IS NULL
  AND c.ai_score IS NOT NULL;

-- Backfill remaining flags from iqs_scores where original_score is still null
UPDATE iqs_flags f
SET original_score = s.iqs_score
FROM iqs_scores s
WHERE f.chat_id = s.chat_id
  AND f.original_score IS NULL
  AND s.iqs_score IS NOT NULL;
