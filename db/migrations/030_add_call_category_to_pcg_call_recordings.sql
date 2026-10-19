-- Migration 030: Add call_category column to pcg_call_recordings
ALTER TABLE pcg_call_recordings 
ADD COLUMN IF NOT EXISTS call_category VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_pcg_call_category ON pcg_call_recordings(call_category);
