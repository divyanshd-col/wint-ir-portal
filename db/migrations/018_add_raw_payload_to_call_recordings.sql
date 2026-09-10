-- Migration 018: Add raw_payload JSONB column to call_recordings table
-- Stores the original raw webhook payload received from Robylon for calls.

ALTER TABLE call_recordings
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;
