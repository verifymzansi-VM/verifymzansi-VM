-- ============================================================
-- Unified Businesses Table Migration
-- Merges storefronts (Mall Shops) + business_profiles (Business Ads)
-- into a single businesses table. Adds business_id to promotions.
-- Migrates storefront_posts + business_posts into promotions.
-- Updates all target_type CHECK constraints and marketplace_area enum.
-- ============================================================

-- ── 1. New enums ─────────────────────────────────────────────

CREATE TYPE business_type AS ENUM (
  'mall_store',
  'standalone_shop',
  'home_business',
  'mobile_service',
  'online_only',
  'market_stall'
);
CREATE TYPE business_category AS ENUM (
  'fashion_accessories',
  'electronics_tech',
  'groceries_essentials',
  'health_beauty',
  'home_living',
  'food_dining',
  'trade_maintenance',
  'professional_services',
  'education_training',
  'events_entertainment',
  'automotive_transport',
  'general_other'
);
-- ── 2. Add MZANSI_BUSINESS to marketplace_area enum ─────────

ALTER TYPE marketplace_area ADD VALUE IF NOT EXISTS 'MZANSI_BUSINESS';
-- ── 3. Create businesses table ──────────────────────────────

CREATE TABLE businesses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area                     marketplace_area NOT NULL DEFAULT 'MZANSI_BUSINESS',
  business_type            business_type NOT NULL,
  business_name            TEXT NOT NULL CHECK (char_length(business_name) BETWEEN 2 AND 100),
  slug                     TEXT CHECK (char_length(slug) BETWEEN 3 AND 60),
  description              TEXT CHECK (char_length(description) <= 3000),
  category                 business_category NOT NULL DEFAULT 'general_other',

  -- Branding / media
  logo_url                 TEXT,
  cover_photo              TEXT,
  cover_video              TEXT,
  video_thumbnail          TEXT,

  -- Location
  location_province        TEXT NOT NULL,
  location_city            TEXT NOT NULL,
  store_number             TEXT,                  -- relevant for mall_store
  mall_id                  UUID REFERENCES malls(id) ON DELETE SET NULL,
  map_directions           TEXT,

  -- Contact
  phone                    TEXT,
  whatsapp                 TEXT,
  email                    TEXT,
  website                  TEXT,
  social_links             JSONB,

  -- Business details
  services_offered         TEXT[] DEFAULT '{}',
  service_areas            JSONB,                 -- for mobile_service / delivery coverage
  operating_hours          JSONB,
  payment_methods_accepted TEXT[] DEFAULT '{}',    -- cash, card, eft, snapscan, capitec_pay
  delivery_options         TEXT[] DEFAULT '{}',    -- in_store, delivery, collection, nationwide

  -- Status (same pattern as listings)
  status                   listing_status NOT NULL DEFAULT 'draft',
  status_reason            TEXT,
  entitlement_id           UUID REFERENCES entitlements(id) ON DELETE SET NULL,
  boost_until              TIMESTAMPTZ,
  featured_until           TIMESTAMPTZ,

  -- Full-text search
  search_vector            TSVECTOR,

  -- Timestamps
  published_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ── 4. Indexes ──────────────────────────────────────────────

CREATE INDEX idx_businesses_seller        ON businesses(seller_id);
CREATE INDEX idx_businesses_status        ON businesses(status);
CREATE INDEX idx_businesses_category      ON businesses(category);
CREATE INDEX idx_businesses_type          ON businesses(business_type);
CREATE INDEX idx_businesses_province_city ON businesses(location_province, location_city);
CREATE INDEX idx_businesses_mall          ON businesses(mall_id) WHERE mall_id IS NOT NULL;
CREATE INDEX idx_businesses_search        ON businesses USING GIN(search_vector);
CREATE INDEX idx_businesses_live          ON businesses(created_at DESC) WHERE status = 'live';
CREATE INDEX idx_businesses_boost         ON businesses(boost_until DESC NULLS LAST)
  WHERE status = 'live';
CREATE INDEX idx_businesses_promo_sort    ON businesses(
  boost_until DESC NULLS LAST,
  featured_until DESC NULLS LAST,
  created_at DESC
) WHERE status = 'live';
-- ── 5. Full-text search trigger ─────────────────────────────

CREATE FUNCTION businesses_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.business_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER businesses_search_trigger
  BEFORE INSERT OR UPDATE OF business_name, description ON businesses
  FOR EACH ROW EXECUTE FUNCTION businesses_search_update();
-- ── 6. updated_at trigger ───────────────────────────────────

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- ── 7. RLS ──────────────────────────────────────────────────

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public reads live businesses"
  ON businesses FOR SELECT
  USING (status = 'live' OR auth.uid() = seller_id);
CREATE POLICY "Staff reads all businesses"
  ON businesses FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner creates business"
  ON businesses FOR INSERT
  WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "Owner or moderator updates business"
  ON businesses FOR UPDATE
  USING (auth.uid() = seller_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes business"
  ON businesses FOR DELETE
  USING (auth.uid() = seller_id OR public.has_role('admin'));
-- ── 8. Add business_id to promotions ────────────────────────

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;
CREATE INDEX idx_promotions_business
  ON promotions(business_id) WHERE business_id IS NOT NULL;
-- ── 9. Data migration: storefronts → businesses ─────────────

INSERT INTO businesses (
  id, seller_id, area, business_type, business_name, description,
  category, logo_url, cover_photo, cover_video, video_thumbnail,
  location_province, location_city, store_number, mall_id,
  map_directions, phone, whatsapp, email, social_links,
  operating_hours, status, status_reason, entitlement_id,
  boost_until, published_at, created_at, updated_at
)
SELECT
  s.id,
  s.seller_id,
  'MZANSI_BUSINESS'::marketplace_area,
  'mall_store'::business_type,
  s.mall_name,
  s.description,
  CASE s.category
    WHEN 'mall_fashion'       THEN 'fashion_accessories'::business_category
    WHEN 'mall_electronics'   THEN 'electronics_tech'::business_category
    WHEN 'mall_groceries'     THEN 'groceries_essentials'::business_category
    WHEN 'mall_health_beauty' THEN 'health_beauty'::business_category
    WHEN 'mall_home_decor'    THEN 'home_living'::business_category
    WHEN 'mall_sports_hobbies' THEN 'general_other'::business_category
    WHEN 'mall_dining'        THEN 'food_dining'::business_category
    WHEN 'mall_services'      THEN 'professional_services'::business_category
    ELSE 'general_other'::business_category
  END,
  s.logo_url,
  s.cover_photo,
  s.cover_video,
  s.video_thumbnail,
  s.location_province,
  s.location_city,
  s.store_number,
  s.mall_id,
  s.map_directions,
  s.phone,
  s.whatsapp,
  s.email,
  s.social_links,
  s.operating_hours,
  s.status,
  s.status_reason,
  s.entitlement_id,
  s.boost_until,
  s.published_at,
  s.created_at,
  s.updated_at
FROM storefronts s;
-- ── 10. Data migration: business_profiles → businesses ──────

INSERT INTO businesses (
  id, seller_id, area, business_type, business_name, description,
  category, logo_url, cover_photo, cover_video, video_thumbnail,
  location_province, location_city,
  phone, whatsapp, email, website, social_links,
  services_offered, service_areas, operating_hours,
  status, status_reason, entitlement_id,
  boost_until, published_at, created_at, updated_at
)
SELECT
  bp.id,
  bp.seller_id,
  'MZANSI_BUSINESS'::marketplace_area,
  'standalone_shop'::business_type,
  bp.business_name,
  bp.about,
  CASE bp.category
    WHEN 'biz_events'       THEN 'events_entertainment'::business_category
    WHEN 'biz_government'   THEN 'professional_services'::business_category
    WHEN 'biz_home_trades'  THEN 'trade_maintenance'::business_category
    WHEN 'biz_professional' THEN 'professional_services'::business_category
    WHEN 'biz_education'    THEN 'education_training'::business_category
    WHEN 'biz_automotive'   THEN 'automotive_transport'::business_category
    WHEN 'biz_health'       THEN 'health_beauty'::business_category
    WHEN 'biz_general'      THEN 'general_other'::business_category
    ELSE 'general_other'::business_category
  END,
  bp.logo_url,
  bp.cover_photo,
  bp.cover_video,
  bp.video_thumbnail,
  COALESCE(bp.location_province, ''),
  COALESCE(bp.location_city, ''),
  bp.phone,
  bp.whatsapp,
  bp.email,
  bp.website,
  bp.social_links,
  bp.services_offered,
  bp.service_areas,
  bp.operating_hours,
  bp.status,
  bp.status_reason,
  bp.entitlement_id,
  bp.boost_until,
  bp.published_at,
  bp.created_at,
  bp.updated_at
FROM business_profiles bp
WHERE bp.id NOT IN (SELECT id FROM businesses);
-- ── 11. Data migration: storefront_posts → promotions ───────
-- Map storefront post types to promotion types and link via business_id.

INSERT INTO promotions (
  seller_id, business_id, title, description,
  promotion_type, photos, location_province, location_city,
  contact_methods, status, published_at, created_at, updated_at
)
SELECT
  sp.seller_id,
  sp.storefront_id,                 -- becomes business_id (same UUID)
  sp.title,
  COALESCE(sp.body, sp.description, sp.title),
  CASE sp.type
    WHEN 'event'     THEN 'event'::promotion_type
    WHEN 'promotion' THEN 'deal'::promotion_type
    WHEN 'special'   THEN 'deal'::promotion_type
    ELSE 'general'::promotion_type
  END,
  COALESCE(sp.media_urls, CASE WHEN sp.media IS NOT NULL THEN ARRAY[sp.media] ELSE '{}' END),
  s.location_province,
  s.location_city,
  '{call}',
  sp.status,
  CASE WHEN sp.status = 'live' THEN sp.created_at ELSE NULL END,
  sp.created_at,
  sp.created_at
FROM storefront_posts sp
JOIN storefronts s ON s.id = sp.storefront_id;
-- ── 12. Data migration: business_posts → promotions ─────────

INSERT INTO promotions (
  seller_id, business_id, title, description,
  promotion_type, photos, location_province, location_city,
  contact_methods, status, published_at, created_at, updated_at
)
SELECT
  bp_post.seller_id,
  bp_post.business_profile_id,       -- becomes business_id (same UUID)
  bp_post.title,
  COALESCE(bp_post.body, bp_post.description, bp_post.title),
  CASE bp_post.type
    WHEN 'offer'      THEN 'deal'::promotion_type
    WHEN 'hiring'     THEN 'service'::promotion_type
    WHEN 'case_study' THEN 'general'::promotion_type
    WHEN 'special'    THEN 'deal'::promotion_type
    ELSE 'general'::promotion_type
  END,
  COALESCE(bp_post.media_urls, CASE WHEN bp_post.media IS NOT NULL THEN ARRAY[bp_post.media] ELSE '{}' END),
  COALESCE(bp.location_province, ''),
  COALESCE(bp.location_city, ''),
  '{call}',
  bp_post.status,
  CASE WHEN bp_post.status = 'live' THEN bp_post.created_at ELSE NULL END,
  bp_post.created_at,
  bp_post.created_at
FROM business_posts bp_post
JOIN business_profiles bp ON bp.id = bp_post.business_profile_id;
-- ── 13. Update entitlements area references ─────────────────

UPDATE entitlements
SET area = 'MZANSI_BUSINESS'::marketplace_area
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- ── 14. Update payments area references ─────────────────────

UPDATE payments
SET area = 'MZANSI_BUSINESS'::marketplace_area
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- ── 15. Update plans seed data ──────────────────────────────

-- Insert new Mzansi Business plans
INSERT INTO plans (area, tier, name, price_cents, billing_frequency, features) VALUES
  ('MZANSI_BUSINESS', 'starter', 'Mzansi Business Starter', 15000, 'monthly',
   '{"businesses": 1, "photos": 5, "videos": 1, "cover_video": false, "boost": false, "featured": false}'),
  ('MZANSI_BUSINESS', 'growth', 'Mzansi Business Growth', 40000, 'monthly',
   '{"businesses": 3, "photos": 10, "videos": 3, "cover_video": true, "boost": true, "featured": false}'),
  ('MZANSI_BUSINESS', 'pro', 'Mzansi Business Pro', 100000, 'monthly',
   '{"businesses": 9, "photos": 10, "videos": 9, "cover_video": true, "boost": true, "featured": true}');
-- Deactivate old Mall Shops and Business Ads plans
UPDATE plans SET active = false WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- ── 16. Update target_type CHECK constraints ────────────────
-- Add 'business' to allowed target_types in leads, contact_events, reports, listing_views.

-- leads
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_target_type_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_target_type_check
  CHECK (target_type IN ('listing', 'storefront', 'business_profile', 'business', 'promotion'));
-- Migrate existing target_type values
UPDATE leads SET target_type = 'business'
WHERE target_type IN ('storefront', 'business_profile');
-- contact_events
ALTER TABLE contact_events DROP CONSTRAINT IF EXISTS contact_events_target_type_check;
ALTER TABLE contact_events
  ADD CONSTRAINT contact_events_target_type_check
  CHECK (target_type IN ('listing', 'storefront', 'business_profile', 'business', 'promotion'));
UPDATE contact_events SET target_type = 'business'
WHERE target_type IN ('storefront', 'business_profile');
-- reports
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('listing', 'storefront', 'business_profile', 'business', 'promotion'));
UPDATE reports SET target_type = 'business'
WHERE target_type IN ('storefront', 'business_profile');
-- listing_views
ALTER TABLE listing_views DROP CONSTRAINT IF EXISTS listing_views_target_type_check;
ALTER TABLE listing_views
  ADD CONSTRAINT listing_views_target_type_check
  CHECK (target_type IN ('listing', 'storefront', 'business_profile', 'business', 'promotion'));
UPDATE listing_views SET target_type = 'business'
WHERE target_type IN ('storefront', 'business_profile');
-- ── 17. Update free_posts_used for new area ─────────────────

UPDATE free_posts_used
SET area = 'MZANSI_BUSINESS'::marketplace_area
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- ── 18. Update audit_logs area references ───────────────────

UPDATE audit_logs
SET area = 'MZANSI_BUSINESS'::marketplace_area
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- ── 19. Update moderation_actions area references ───────────

UPDATE moderation_actions
SET area = 'MZANSI_BUSINESS'::marketplace_area
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- ── 20. Update reports area references ──────────────────────

UPDATE reports
SET area = 'MZANSI_BUSINESS'::marketplace_area
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);
-- NOTE: Old tables (storefronts, business_profiles, storefront_posts, business_posts)
-- are NOT dropped yet. They remain as read-only backups until the application is fully
-- migrated and stable on the new businesses table.;
