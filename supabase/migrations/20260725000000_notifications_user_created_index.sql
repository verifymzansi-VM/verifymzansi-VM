-- Add composite index to serve the primary notification fetch pattern:
--   WHERE user_id = ? ORDER BY created_at DESC LIMIT n
-- The existing (user_id, read, created_at DESC) index only helps when
-- filtering by read status; this covers the unfiltered list query.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
