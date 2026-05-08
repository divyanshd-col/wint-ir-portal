-- Partial index speeds up "find unlinked calls for a contact" query
-- used by the TICKET_CLOSED handler to link calls recorded before chat close.
CREATE INDEX IF NOT EXISTS call_recordings_contact_unlinked_idx
  ON call_recordings (contact_id, called_at DESC)
  WHERE chat_id IS NULL;
