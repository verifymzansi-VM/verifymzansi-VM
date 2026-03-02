-- Notifications table for seller + admin in-app notifications
-- Powers the NotificationBell component and dashboard attention system

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'info'
              CHECK (type IN ('info', 'success', 'warning', 'error')),
  title       TEXT NOT NULL,
  message     TEXT,
  href        TEXT,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by user + unread
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, read, created_at DESC);

-- Index for cleanup of old notifications
CREATE INDEX idx_notifications_created_at
  ON notifications (created_at);

-- RLS: users can only see/update their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Service role can insert notifications (from API routes / server actions)
CREATE POLICY "Service role can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- Enable Supabase Realtime on notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Auto-cleanup old notifications (older than 90 days)
-- Uses pg_cron if available, otherwise manual cleanup via scheduled worker
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-old-notifications',
      '0 3 * * *',  -- daily at 3am
      $$DELETE FROM notifications WHERE created_at < now() - interval '90 days'$$
    );
  END IF;
END $$;
