-- Fix post type CHECK constraint mismatch
-- The DB had ('special', 'announcement') but the Zod validation schemas
-- use ('update', 'promotion', 'event') for storefronts and
-- ('update', 'case_study', 'offer', 'hiring') for businesses.
-- Also widen storefront_posts schema: add body, media_urls columns
-- to match the Zod storefrontPostSchema / businessPostSchema fields.

-- ── storefront_posts: align CHECK constraint + add columns ──
ALTER TABLE storefront_posts DROP CONSTRAINT IF EXISTS storefront_posts_type_check;
ALTER TABLE storefront_posts
  ADD CONSTRAINT storefront_posts_type_check
  CHECK (type IN ('special', 'announcement', 'update', 'promotion', 'event'));

-- Add optional body (longer text) and media_urls (JSON array) columns.
-- The original schema only had `media TEXT NOT NULL` and `description TEXT`.
-- The Zod schema sends `body` and `media_urls`.
ALTER TABLE storefront_posts
  ADD COLUMN IF NOT EXISTS body TEXT CHECK (char_length(body) <= 3000);
ALTER TABLE storefront_posts
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';
ALTER TABLE storefront_posts
  ALTER COLUMN media DROP NOT NULL; -- allow posts without a single media string
ALTER TABLE storefront_posts
  ALTER COLUMN title TYPE TEXT; -- remove length constraint, Zod handles it
DROP INDEX IF EXISTS idx_storefront_posts_status;
CREATE INDEX IF NOT EXISTS idx_storefront_posts_status
  ON storefront_posts(storefront_id, status) WHERE status = 'live';

-- ── business_posts: align CHECK constraint + add columns ──
ALTER TABLE business_posts DROP CONSTRAINT IF EXISTS business_posts_type_check;
ALTER TABLE business_posts
  ADD CONSTRAINT business_posts_type_check
  CHECK (type IN ('special', 'announcement', 'update', 'case_study', 'offer', 'hiring'));

ALTER TABLE business_posts
  ADD COLUMN IF NOT EXISTS body TEXT CHECK (char_length(body) <= 5000);
ALTER TABLE business_posts
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';
ALTER TABLE business_posts
  ALTER COLUMN media DROP NOT NULL;
ALTER TABLE business_posts
  ALTER COLUMN title TYPE TEXT;
DROP INDEX IF EXISTS idx_business_posts_status;
CREATE INDEX IF NOT EXISTS idx_business_posts_status
  ON business_posts(business_profile_id, status) WHERE status = 'live';

-- ── RLS policies for storefront_posts ──
ALTER TABLE storefront_posts ENABLE ROW LEVEL SECURITY;

-- Sellers can manage their own posts
DROP POLICY IF EXISTS storefront_posts_owner ON storefront_posts;
CREATE POLICY storefront_posts_owner ON storefront_posts
  FOR ALL
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Public read for live posts
DROP POLICY IF EXISTS storefront_posts_public_read ON storefront_posts;
CREATE POLICY storefront_posts_public_read ON storefront_posts
  FOR SELECT
  USING (status = 'live');

-- Admin/moderator full access
DROP POLICY IF EXISTS storefront_posts_admin ON storefront_posts;
CREATE POLICY storefront_posts_admin ON storefront_posts
  FOR ALL
  USING (public.has_any_role(ARRAY['admin', 'moderator']));

-- ── RLS policies for business_posts ──
ALTER TABLE business_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_posts_owner ON business_posts;
CREATE POLICY business_posts_owner ON business_posts
  FOR ALL
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS business_posts_public_read ON business_posts;
CREATE POLICY business_posts_public_read ON business_posts
  FOR SELECT
  USING (status = 'live');

DROP POLICY IF EXISTS business_posts_admin ON business_posts;
CREATE POLICY business_posts_admin ON business_posts
  FOR ALL
  USING (public.has_any_role(ARRAY['admin', 'moderator']));
