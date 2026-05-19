-- 006_call_chunks.sql
-- Adds disposition columns to call_recordings and creates call_transcript_chunks table.

-- Disposition extracted by AI from the call transcript (constrained to the official 14-category list)
ALTER TABLE call_recordings
  ADD COLUMN IF NOT EXISTS call_disposition     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS call_sub_disposition VARCHAR(200);

-- Topic-based chunks extracted from call transcripts for RAG retrieval during future scoring.
-- Each chunk represents one distinct topic discussed during the call.
CREATE TABLE IF NOT EXISTS call_transcript_chunks (
  id          BIGSERIAL PRIMARY KEY,
  call_id     VARCHAR(100) NOT NULL REFERENCES call_recordings(id) ON DELETE CASCADE,
  chat_id     VARCHAR(100),
  contact_id  BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  agent_id    INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  called_at   TIMESTAMPTZ,
  topic       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  content     TEXT NOT NULL,       -- raw call transcript text for this topic chunk
  chunk_index SMALLINT NOT NULL,   -- order within the call (0-based)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_chunks_call_id_idx    ON call_transcript_chunks (call_id);
CREATE INDEX IF NOT EXISTS call_chunks_contact_id_idx ON call_transcript_chunks (contact_id);
CREATE INDEX IF NOT EXISTS call_chunks_called_at_idx  ON call_transcript_chunks (called_at DESC);
CREATE INDEX IF NOT EXISTS call_chunks_chat_id_idx    ON call_transcript_chunks (chat_id);
