-- Avatars are written only by /api/profile/avatar, which checks magic bytes and
-- scans content before uploading with the service role. These browser policies
-- let any signed-in user put arbitrary bytes (labelled as an image) into the
-- public bucket directly, skipping those checks. Owner metadata reads and
-- service-role upload/cleanup are unchanged.
BEGIN;
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
COMMIT;
