-- Migration 045: Add CSAT bifurcation columns to conversations table
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS csat_bifurcation VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bifurcated_csat_label VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_conversations_csat_bifurcation ON conversations(csat_bifurcation);
