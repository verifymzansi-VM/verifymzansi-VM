-- Add video_thumbnail column for explicit video cover images
ALTER TABLE listings ADD COLUMN IF NOT EXISTS video_thumbnail text;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS video_thumbnail text;
