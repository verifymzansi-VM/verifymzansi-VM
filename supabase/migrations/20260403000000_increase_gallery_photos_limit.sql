-- Increase gallery photos limit from 5 to 10 per business
ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS chk_gallery_photos_max_5;

ALTER TABLE businesses
  ADD CONSTRAINT chk_gallery_photos_max_10
  CHECK (array_length(gallery_photos, 1) <= 10 OR gallery_photos = '{}' OR gallery_photos IS NULL);

COMMENT ON COLUMN businesses.gallery_photos IS 'Up to 10 profile/gallery photo URLs showcasing the business';
