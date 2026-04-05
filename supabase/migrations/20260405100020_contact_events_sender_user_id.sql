-- Track which authenticated user sent each contact message.
-- Enables per-sender abuse detection, DSAR exports, and audit trails.
-- Nullable because unauthenticated (guest) users can also send contact messages.
ALTER TABLE contact_events
  ADD COLUMN IF NOT EXISTS sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contact_events_sender
  ON contact_events (sender_user_id)
  WHERE sender_user_id IS NOT NULL;
