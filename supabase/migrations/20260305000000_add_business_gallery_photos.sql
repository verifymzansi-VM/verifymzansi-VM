-- Add gallery photos support for Mzansi Business profiles
-- Allows up to 5 profile/gallery images per business

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS gallery_photos TEXT[] DEFAULT '{}';

-- Enforce max 5 gallery photos at DB level
ALTER TABLE businesses
  ADD CONSTRAINT chk_gallery_photos_max_5
  CHECK (array_length(gallery_photos, 1) <= 5 OR gallery_photos = '{}' OR gallery_photos IS NULL);

-- Comment for documentation
COMMENT ON COLUMN businesses.gallery_photos IS 'Up to 5 profile/gallery photo URLs showcasing the business';
