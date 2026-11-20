-- Migration 038: Strictly mark all junk calls and chats as NIL IQS (NULL)
-- Ensure no junk disposition or junk tag carries an IQS score in historical records.

-- 1. Invalidate chat, bot, and call IQS scores for conversations with junk tags
UPDATE iqs_scores s
SET iqs_score = NULL,
    bot_iqs_score = NULL,
    call_iqs_score = NULL
FROM conversations c
WHERE s.chat_id = c.id
  AND c.tags::text ILIKE '%junk%'
  AND (s.iqs_score IS NOT NULL OR s.bot_iqs_score IS NOT NULL OR s.call_iqs_score IS NOT NULL);

-- 2. Invalidate call_evaluations for junk calls or calls associated with junk chats
UPDATE call_evaluations ce
SET iqs_percent = NULL,
    applicable_weight = 0,
    verdict = 'NOT_SCOREABLE'
FROM call_recordings cr
LEFT JOIN conversations c ON c.id = cr.chat_id
WHERE ce.call_id = cr.id
  AND (
    cr.call_disposition ILIKE '%junk%'
    OR cr.call_sub_disposition ILIKE '%junk%'
    OR c.tags::text ILIKE '%junk%'
  )
  AND (ce.iqs_percent IS NOT NULL OR ce.verdict IS DISTINCT FROM 'NOT_SCOREABLE');

-- 3. Invalidate call_iqs_score on iqs_scores for calls that have junk dispositions
UPDATE iqs_scores s
SET call_iqs_score = NULL
FROM call_recordings cr
WHERE s.chat_id = cr.chat_id
  AND (
    cr.call_disposition ILIKE '%junk%'
    OR cr.call_sub_disposition ILIKE '%junk%'
  )
  AND s.call_iqs_score IS NOT NULL;

