-- Track all media uploads to R2 so orphans (uploads never saved to content)
-- can be detected and cleaned up by the retention-cleanup worker.
--
-- A media upload is "orphaned" if it has no matching URL in listings,
-- businesses, or promotions image_urls arrays after a grace period.

CREATE TABLE IF NOT EXISTS media_uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL,
  bucket      TEXT NOT NULL DEFAULT 'public',
  url         TEXT NOT NULL,
  content_type TEXT,
  file_size   INTEGER,
  area        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ  -- set when the URL is saved to a content row
);

CREATE INDEX idx_media_uploads_user ON media_uploads(user_id);
CREATE INDEX idx_media_uploads_orphan ON media_uploads(confirmed_at, created_at)
  WHERE confirmed_at IS NULL;

-- RLS: users can only see their own uploads
ALTER TABLE media_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_uploads_select ON media_uploads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY media_uploads_insert ON media_uploads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for cleanup worker)
CREATE POLICY media_uploads_service_all ON media_uploads
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
