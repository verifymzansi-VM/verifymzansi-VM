-- Align the public avatars bucket with the server-side avatar upload contract.
-- The API accepts JPEG, PNG, and WebP avatars up to 2 MB.

UPDATE storage.buckets
SET
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'avatars';
