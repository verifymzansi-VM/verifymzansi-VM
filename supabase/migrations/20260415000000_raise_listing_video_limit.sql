-- ============================================================
-- Raise the per-listing video limit from 2 → 27
-- Aligns the DB CHECK constraint with the Mzansi Market Pro
-- plan which now allows up to 27 videos.
-- ============================================================

-- Drop the old constraint (auto-named from the CREATE TABLE definition)
ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_videos_check;

-- Re-add with the new ceiling
ALTER TABLE listings
  ADD CONSTRAINT listings_videos_check
  CHECK (array_length(videos, 1) <= 27 OR videos = '{}');
