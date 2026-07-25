-- Require server-side validation before media can be attached to content.
--
-- Context: /api/media/upload-url issues a presigned R2 URL and records a
-- tracking row BEFORE any content validation. /api/media/upload-complete
-- validates the uploaded object (magic bytes, size, malware scan) but its
-- success was never persisted, so confirmMediaUploads() could not
-- distinguish validated uploads from never-validated ones — allowing
-- arbitrary bytes to be attached to live posts via a skipped completion call.
--
-- validated_at is set only after the object passes server-side validation:
--   - /api/media/upload (server-validated path) sets it at insert time
--   - /api/media/upload-complete (direct R2 path) sets it after all checks pass
--
-- Backfill: rows already attached to content (confirmed_at IS NOT NULL) went
-- through the previous accepted flows, so grandfather them to keep edits of
-- existing posts working. Unconfirmed rows stay NULL and remain sweepable by
-- the retention-cleanup worker.

ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

UPDATE media_uploads
SET validated_at = confirmed_at
WHERE validated_at IS NULL
  AND confirmed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_uploads_unvalidated
  ON media_uploads(validated_at, created_at)
  WHERE validated_at IS NULL;
