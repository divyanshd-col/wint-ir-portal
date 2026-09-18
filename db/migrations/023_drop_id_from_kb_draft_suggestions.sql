-- Migration 023: Drop id column from kb_draft_suggestions table
ALTER TABLE kb_draft_suggestions DROP COLUMN IF EXISTS id;
