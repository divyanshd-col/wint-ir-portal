-- call_recordings.status was VARCHAR(20) but 'pending_transcription' is 21 chars.
-- Widen to VARCHAR(30) to cover all status values in use.
ALTER TABLE call_recordings
  ALTER COLUMN status TYPE VARCHAR(30);
