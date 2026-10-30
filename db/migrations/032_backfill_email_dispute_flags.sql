-- Migration 032: Backfill message_id in iqs_flags from email_reply_evaluations
-- Ensures email disputes are cleanly separated from chat disputes across all queries.

UPDATE iqs_flags f
SET message_id = e.message_id
FROM email_reply_evaluations e
WHERE e.flag_id = f.id AND (f.message_id IS NULL OR f.message_id = '');

UPDATE iqs_flags f
SET message_id = e.message_id
FROM email_reply_evaluations e
WHERE (f.chat_id = e.ticket_id OR f.chat_id = e.message_id OR f.score_id = e.message_id)
  AND (f.message_id IS NULL OR f.message_id = '');

