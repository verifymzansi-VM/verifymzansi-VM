-- VerifyMzansi Initial Database Schema
-- PostgreSQL 15 (Supabase)
-- All tables have RLS enabled.

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE marketplace_area AS ENUM ('MZANSI_MARKET', 'BUSINESS_ADS', 'MALL_SHOPS');
CREATE TYPE verification_step_type AS ENUM ('phone', 'id_doc', 'selfie', 'location');
CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected', 'needs_resubmission');
CREATE TYPE seller_verification_status AS ENUM ('incomplete', 'pending_review', 'verified');
CREATE TYPE document_type AS ENUM ('sa_id_card', 'sa_id_book', 'sa_passport', 'sa_drivers_license');
CREATE TYPE location_method AS ENUM ('gps', 'proof_of_address');
CREATE TYPE listing_status AS ENUM ('draft', 'pending_moderation', 'flagged_for_review', 'live', 'hidden', 'expired', 'rejected');
CREATE TYPE listing_category AS ENUM ('property', 'cars_vehicles', 'auto_parts_tools', 'electronics_tech', 'home_lifestyle', 'jobs_other');
CREATE TYPE contact_method AS ENUM ('call', 'whatsapp', 'form');
CREATE TYPE plan_tier AS ENUM ('starter', 'growth', 'pro');
CREATE TYPE entitlement_type AS ENUM ('subscription', 'trial', 'pay_per_post');
CREATE TYPE entitlement_status AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'complete', 'failed', 'refunded');
CREATE TYPE lead_status AS ENUM ('new', 'read', 'contacted', 'closed');
CREATE TYPE contact_event_type AS ENUM ('call', 'whatsapp', 'form');
CREATE TYPE report_category AS ENUM ('scam', 'prohibited_item', 'impersonation', 'harassment', 'misleading_info');
CREATE TYPE report_severity AS ENUM ('high', 'standard');
CREATE TYPE report_status AS ENUM ('open', 'in_progress', 'resolved', 'dismissed');
CREATE TYPE enforcement_action AS ENUM ('warn', 'hide', 'suspend', 'ban', 'dismiss');
CREATE TYPE account_status AS ENUM ('active', 'warned', 'suspended', 'banned');
CREATE TYPE user_role AS ENUM ('seller', 'moderator', 'admin');
CREATE TYPE dsar_type AS ENUM ('access', 'correction', 'deletion');
CREATE TYPE dsar_status AS ENUM ('submitted', 'identity_pending', 'in_progress', 'completed', 'rejected');
CREATE TYPE buyer_token_status AS ENUM ('valid', 'expired', 'revoked');
-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(required_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT (raw_user_meta_data->>'role') = required_role
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
CREATE OR REPLACE FUNCTION public.has_any_role(roles TEXT[])
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT (raw_user_meta_data->>'role') = ANY(roles)
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- ============================================================
-- TABLES
-- ============================================================

-- seller_profiles
CREATE TABLE seller_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  seller_verification_status seller_verification_status NOT NULL DEFAULT 'incomplete',
  phone TEXT,
  masked_phone_public TEXT,
  location_province TEXT,
  location_city TEXT,
  location_verified_at TIMESTAMPTZ,
  account_status account_status NOT NULL DEFAULT 'active',
  strikes INTEGER NOT NULL DEFAULT 0,
  suspended_until TIMESTAMPTZ,
  banned_at TIMESTAMPTZ,
  ban_reason TEXT,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  profile_completeness_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);
CREATE INDEX idx_seller_profiles_user_id ON seller_profiles(user_id);
CREATE INDEX idx_seller_profiles_status ON seller_profiles(seller_verification_status);
CREATE INDEX idx_seller_profiles_account ON seller_profiles(account_status);
-- verification_steps
CREATE TABLE verification_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_type verification_step_type NOT NULL,
  status verification_status NOT NULL DEFAULT 'pending',
  full_name TEXT,
  id_number_encrypted TEXT,
  id_number_iv TEXT,
  id_number_tag TEXT,
  dob DATE,
  document_type document_type,
  location_method location_method,
  gps_lat DOUBLE PRECISION,
  gps_lon DOUBLE PRECISION,
  location_province TEXT,
  location_city TEXT,
  location_town TEXT,
  phone_verified_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  reason_code TEXT,
  reason_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, step_type)
);
CREATE INDEX idx_verification_steps_user ON verification_steps(user_id);
CREATE INDEX idx_verification_steps_status ON verification_steps(status);
CREATE INDEX idx_verification_steps_pending ON verification_steps(status) WHERE status = 'pending';
-- kyc_artifacts
CREATE TABLE kyc_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_type verification_step_type NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  status verification_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kyc_artifacts_user ON kyc_artifacts(user_id);
CREATE INDEX idx_kyc_artifacts_status ON kyc_artifacts(status);
-- plans
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area marketplace_area NOT NULL,
  tier plan_tier NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  billing_frequency TEXT NOT NULL DEFAULT 'monthly',
  features JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(area, tier)
);
-- entitlements
CREATE TABLE entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area marketplace_area NOT NULL,
  tier plan_tier,
  type entitlement_type NOT NULL,
  status entitlement_status NOT NULL DEFAULT 'active',
  payfast_subscription_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entitlements_user ON entitlements(user_id);
CREATE INDEX idx_entitlements_user_area ON entitlements(user_id, area);
CREATE INDEX idx_entitlements_active ON entitlements(user_id, area, status) WHERE status = 'active';
CREATE INDEX idx_entitlements_trial ON entitlements(user_id, area) WHERE type = 'trial';
-- listings (Mzansi Market)
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area marketplace_area NOT NULL DEFAULT 'MZANSI_MARKET',
  category listing_category NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) <= 100),
  description TEXT NOT NULL CHECK (char_length(description) <= 2000),
  photos TEXT[] NOT NULL CHECK (array_length(photos, 1) >= 1 AND array_length(photos, 1) <= 10),
  videos TEXT[] DEFAULT '{}' CHECK (array_length(videos, 1) <= 2 OR videos = '{}'),
  price_cents INTEGER,
  price_negotiable BOOLEAN DEFAULT false,
  location_province TEXT NOT NULL,
  location_city TEXT NOT NULL,
  location_suburb TEXT,
  contact_methods contact_method[] NOT NULL CHECK (array_length(contact_methods, 1) >= 1),
  buyer_verification_required BOOLEAN NOT NULL DEFAULT false,
  attributes JSONB NOT NULL DEFAULT '{}',
  status listing_status NOT NULL DEFAULT 'draft',
  status_reason TEXT,
  entitlement_id UUID REFERENCES entitlements(id),
  boost_until TIMESTAMPTZ,
  featured BOOLEAN NOT NULL DEFAULT false,
  urgent BOOLEAN NOT NULL DEFAULT false,
  search_vector TSVECTOR,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listings_seller ON listings(seller_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_category ON listings(category);
CREATE INDEX idx_listings_area_status ON listings(area, status);
CREATE INDEX idx_listings_province_city ON listings(location_province, location_city);
CREATE INDEX idx_listings_price ON listings(price_cents) WHERE price_cents IS NOT NULL;
CREATE INDEX idx_listings_search ON listings USING GIN(search_vector);
CREATE INDEX idx_listings_attributes ON listings USING GIN(attributes);
CREATE INDEX idx_listings_live ON listings(created_at DESC) WHERE status = 'live';
-- Full-text search trigger for listings
CREATE FUNCTION listings_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER listings_search_trigger
  BEFORE INSERT OR UPDATE OF title, description ON listings
  FOR EACH ROW EXECUTE FUNCTION listings_search_update();
-- storefronts (Mall Shops)
CREATE TABLE storefronts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area marketplace_area NOT NULL DEFAULT 'MALL_SHOPS',
  cover_photo TEXT NOT NULL,
  cover_video TEXT,
  description TEXT NOT NULL CHECK (char_length(description) <= 2000),
  mall_name TEXT NOT NULL,
  store_number TEXT NOT NULL,
  location_province TEXT NOT NULL,
  location_city TEXT NOT NULL,
  operating_hours JSONB NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  map_directions TEXT,
  status listing_status NOT NULL DEFAULT 'draft',
  status_reason TEXT,
  entitlement_id UUID REFERENCES entitlements(id),
  search_vector TSVECTOR,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_storefronts_seller ON storefronts(seller_id);
CREATE INDEX idx_storefronts_status ON storefronts(status);
CREATE INDEX idx_storefronts_province_city ON storefronts(location_province, location_city);
CREATE INDEX idx_storefronts_search ON storefronts USING GIN(search_vector);
CREATE INDEX idx_storefronts_live ON storefronts(created_at DESC) WHERE status = 'live';
CREATE FUNCTION storefronts_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.mall_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER storefronts_search_trigger
  BEFORE INSERT OR UPDATE OF mall_name, description ON storefronts
  FOR EACH ROW EXECUTE FUNCTION storefronts_search_update();
-- storefront_posts
CREATE TABLE storefront_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id UUID NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('special', 'announcement')),
  title TEXT NOT NULL CHECK (char_length(title) <= 100),
  media TEXT NOT NULL,
  description TEXT CHECK (char_length(description) <= 500),
  valid_until DATE,
  status listing_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_storefront_posts_storefront ON storefront_posts(storefront_id);
-- business_profiles (Business Ads)
CREATE TABLE business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area marketplace_area NOT NULL DEFAULT 'BUSINESS_ADS',
  cover_photo TEXT NOT NULL,
  cover_video TEXT,
  business_name TEXT NOT NULL,
  about TEXT NOT NULL CHECK (char_length(about) <= 2000),
  services_offered TEXT[] NOT NULL CHECK (array_length(services_offered, 1) >= 1),
  service_areas JSONB NOT NULL,
  operating_hours JSONB NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  website TEXT,
  status listing_status NOT NULL DEFAULT 'draft',
  status_reason TEXT,
  entitlement_id UUID REFERENCES entitlements(id),
  search_vector TSVECTOR,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_business_profiles_seller ON business_profiles(seller_id);
CREATE INDEX idx_business_profiles_status ON business_profiles(status);
CREATE INDEX idx_business_profiles_search ON business_profiles USING GIN(search_vector);
CREATE INDEX idx_business_profiles_live ON business_profiles(created_at DESC) WHERE status = 'live';
CREATE FUNCTION business_profiles_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.business_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.about, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER business_profiles_search_trigger
  BEFORE INSERT OR UPDATE OF business_name, about ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION business_profiles_search_update();
-- business_posts
CREATE TABLE business_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('special', 'announcement')),
  title TEXT NOT NULL CHECK (char_length(title) <= 100),
  media TEXT NOT NULL,
  description TEXT CHECK (char_length(description) <= 500),
  valid_until DATE,
  status listing_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_business_posts_profile ON business_posts(business_profile_id);
-- payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  entitlement_id UUID REFERENCES entitlements(id),
  area marketplace_area NOT NULL,
  amount_cents INTEGER NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  payfast_payment_id TEXT,
  payfast_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
-- invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  payment_id UUID REFERENCES payments(id),
  amount_cents INTEGER NOT NULL,
  vat_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invoices_user ON invoices(user_id);
CREATE SEQUENCE invoice_number_seq START 1;
-- leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'storefront', 'business_profile')),
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  buyer_name TEXT,
  buyer_email TEXT,
  buyer_phone TEXT,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 1000),
  status lead_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leads_seller ON leads(seller_id);
CREATE INDEX idx_leads_target ON leads(target_id, target_type);
CREATE INDEX idx_leads_status ON leads(seller_id, status);
-- contact_events
CREATE TABLE contact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'storefront', 'business_profile')),
  seller_id UUID NOT NULL,
  seller_verified BOOLEAN NOT NULL,
  contact_type contact_event_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contact_events_seller ON contact_events(seller_id);
CREATE INDEX idx_contact_events_date ON contact_events(created_at);
CREATE INDEX idx_contact_events_tcr ON contact_events(seller_verified, created_at);
-- reports
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'storefront', 'business_profile')),
  area marketplace_area NOT NULL,
  category report_category NOT NULL,
  severity report_severity NOT NULL,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 500),
  screenshot_url TEXT,
  reporter_user_id UUID REFERENCES auth.users(id),
  reporter_ip_hash TEXT NOT NULL,
  status report_status NOT NULL DEFAULT 'open',
  assigned_to UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reports_area_status ON reports(area, status);
CREATE INDEX idx_reports_severity ON reports(severity, status) WHERE status = 'open';
CREATE INDEX idx_reports_target ON reports(target_id, target_type);
CREATE INDEX idx_reports_open ON reports(created_at) WHERE status = 'open';
-- moderation_actions
CREATE TABLE moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES reports(id),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action enforcement_action NOT NULL,
  target_seller_id UUID REFERENCES auth.users(id),
  area marketplace_area NOT NULL,
  reason TEXT,
  duration_days INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_moderation_actions_report ON moderation_actions(report_id);
CREATE INDEX idx_moderation_actions_actor ON moderation_actions(actor_id);
CREATE INDEX idx_moderation_actions_area ON moderation_actions(area, created_at);
-- audit_logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_role user_role NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  area marketplace_area,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_area ON audit_logs(area, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
-- otp_logs
CREATE TABLE otp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_otp_logs_phone ON otp_logs(phone, created_at DESC);
CREATE INDEX idx_otp_logs_cleanup ON otp_logs(created_at);
-- buyer_verifications
CREATE TABLE buyer_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  first_name_initial TEXT,
  kyc_artifact_ids UUID[],
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status buyer_token_status NOT NULL DEFAULT 'valid',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_buyer_tokens_token ON buyer_verifications(token);
CREATE INDEX idx_buyer_verifications_expiry ON buyer_verifications(expires_at) WHERE status = 'valid';
-- dsar_cases
CREATE TABLE dsar_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type dsar_type NOT NULL,
  requester_email TEXT NOT NULL,
  requester_phone TEXT NOT NULL,
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  description TEXT NOT NULL,
  status dsar_status NOT NULL DEFAULT 'submitted',
  due_by TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  response_summary TEXT,
  processed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dsar_status ON dsar_cases(status);
CREATE INDEX idx_dsar_due ON dsar_cases(due_by) WHERE status != 'completed';
-- consent_records
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  consent_type TEXT NOT NULL,
  version TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_consent_user ON consent_records(user_id);
-- listing_views
CREATE TABLE listing_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'storefront', 'business_profile')),
  viewer_ip_hash TEXT,
  viewer_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listing_views_target ON listing_views(target_id, target_type);
CREATE INDEX idx_listing_views_date ON listing_views(created_at);
CREATE INDEX idx_listing_views_target_date ON listing_views(target_id, target_type, created_at);
-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON seller_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON verification_steps FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON storefronts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON business_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON entitlements FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dsar_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE seller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefronts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsar_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_views ENABLE ROW LEVEL SECURITY;
-- ============================================================
-- RLS POLICIES
-- ============================================================

-- seller_profiles
CREATE POLICY "Owner reads own profile" ON seller_profiles FOR SELECT
  USING (auth.uid() = user_id OR public.has_role('admin'));
CREATE POLICY "Owner creates profile" ON seller_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner or admin updates profile" ON seller_profiles FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role('admin'));
CREATE POLICY "Admin deletes profile" ON seller_profiles FOR DELETE
  USING (public.has_role('admin'));
-- verification_steps
CREATE POLICY "Owner reads own steps" ON verification_steps FOR SELECT
  USING (auth.uid() = user_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Reviewer updates steps" ON verification_steps FOR UPDATE
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
-- kyc_artifacts
CREATE POLICY "Owner reads own artifacts" ON kyc_artifacts FOR SELECT
  USING (auth.uid() = user_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner uploads artifact" ON kyc_artifacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- listings
CREATE POLICY "Public reads live listings" ON listings FOR SELECT
  USING (status = 'live' OR auth.uid() = seller_id);
CREATE POLICY "Staff reads all listings" ON listings FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner creates listing" ON listings FOR INSERT
  WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "Owner or moderator updates listing" ON listings FOR UPDATE
  USING (auth.uid() = seller_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes listing" ON listings FOR DELETE
  USING (auth.uid() = seller_id OR public.has_role('admin'));
-- storefronts
CREATE POLICY "Public reads live storefronts" ON storefronts FOR SELECT
  USING (status = 'live' OR auth.uid() = seller_id);
CREATE POLICY "Staff reads all storefronts" ON storefronts FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner creates storefront" ON storefronts FOR INSERT
  WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "Owner or moderator updates storefront" ON storefronts FOR UPDATE
  USING (auth.uid() = seller_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes storefront" ON storefronts FOR DELETE
  USING (auth.uid() = seller_id OR public.has_role('admin'));
-- business_profiles
CREATE POLICY "Public reads live business profiles" ON business_profiles FOR SELECT
  USING (status = 'live' OR auth.uid() = seller_id);
CREATE POLICY "Staff reads all business profiles" ON business_profiles FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner creates business profile" ON business_profiles FOR INSERT
  WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "Owner or moderator updates business profile" ON business_profiles FOR UPDATE
  USING (auth.uid() = seller_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes business profile" ON business_profiles FOR DELETE
  USING (auth.uid() = seller_id OR public.has_role('admin'));
-- storefront_posts
CREATE POLICY "Public reads live storefront posts" ON storefront_posts FOR SELECT
  USING (status = 'live' OR auth.uid() = (SELECT seller_id FROM storefronts WHERE id = storefront_posts.storefront_id));
CREATE POLICY "Staff reads all storefront posts" ON storefront_posts FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner creates storefront post" ON storefront_posts FOR INSERT
  WITH CHECK (auth.uid() = (SELECT seller_id FROM storefronts WHERE id = storefront_posts.storefront_id));
CREATE POLICY "Owner or moderator updates storefront post" ON storefront_posts FOR UPDATE
  USING (auth.uid() = (SELECT seller_id FROM storefronts WHERE id = storefront_posts.storefront_id) OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes storefront post" ON storefront_posts FOR DELETE
  USING (auth.uid() = (SELECT seller_id FROM storefronts WHERE id = storefront_posts.storefront_id) OR public.has_role('admin'));
-- business_posts
CREATE POLICY "Public reads live business posts" ON business_posts FOR SELECT
  USING (status = 'live' OR auth.uid() = (SELECT seller_id FROM business_profiles WHERE id = business_posts.business_profile_id));
CREATE POLICY "Staff reads all business posts" ON business_posts FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner creates business post" ON business_posts FOR INSERT
  WITH CHECK (auth.uid() = (SELECT seller_id FROM business_profiles WHERE id = business_posts.business_profile_id));
CREATE POLICY "Owner or moderator updates business post" ON business_posts FOR UPDATE
  USING (auth.uid() = (SELECT seller_id FROM business_profiles WHERE id = business_posts.business_profile_id) OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes business post" ON business_posts FOR DELETE
  USING (auth.uid() = (SELECT seller_id FROM business_profiles WHERE id = business_posts.business_profile_id) OR public.has_role('admin'));
-- leads
CREATE POLICY "Owner reads own leads" ON leads FOR SELECT
  USING (auth.uid() = seller_id);
CREATE POLICY "Admin reads all leads" ON leads FOR SELECT
  USING (public.has_role('admin'));
CREATE POLICY "Owner updates lead status" ON leads FOR UPDATE
  USING (auth.uid() = seller_id);
-- contact_events
CREATE POLICY "Admin reads contact events" ON contact_events FOR SELECT
  USING (public.has_role('admin'));
-- reports
CREATE POLICY "Staff reads reports" ON reports FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Staff updates reports" ON reports FOR UPDATE
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
-- moderation_actions
CREATE POLICY "Staff reads moderation actions" ON moderation_actions FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Staff creates moderation action" ON moderation_actions FOR INSERT
  WITH CHECK (public.has_any_role(ARRAY['moderator', 'admin']));
-- audit_logs
CREATE POLICY "Admin reads audit logs" ON audit_logs FOR SELECT
  USING (public.has_role('admin'));
-- entitlements
CREATE POLICY "Owner reads own entitlements" ON entitlements FOR SELECT
  USING (auth.uid() = user_id OR public.has_role('admin'));
-- payments
CREATE POLICY "Owner reads own payments" ON payments FOR SELECT
  USING (auth.uid() = user_id OR public.has_role('admin'));
-- invoices
CREATE POLICY "Owner reads own invoices" ON invoices FOR SELECT
  USING (auth.uid() = user_id OR public.has_role('admin'));
-- plans
CREATE POLICY "Public reads plans" ON plans FOR SELECT
  USING (true);
CREATE POLICY "Admin manages plans" ON plans FOR ALL
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));
-- otp_logs
CREATE POLICY "Admin reads otp logs" ON otp_logs FOR SELECT
  USING (public.has_role('admin'));
-- buyer_verifications
CREATE POLICY "Admin reads buyer verifications" ON buyer_verifications FOR SELECT
  USING (public.has_role('admin'));
-- Token-holder lookup via security definer function (bypasses RLS safely)
-- Buyers verify their token via this function rather than direct table access.
CREATE OR REPLACE FUNCTION public.lookup_buyer_verification(lookup_token UUID)
RETURNS TABLE (
  id UUID,
  phone_verified BOOLEAN,
  first_name_initial TEXT,
  status buyer_token_status,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT bv.id, bv.phone_verified, bv.first_name_initial, bv.status, bv.issued_at, bv.expires_at
  FROM buyer_verifications bv
  WHERE bv.token = lookup_token
    AND bv.status = 'valid'
    AND bv.expires_at > NOW();
$$;
-- dsar_cases
CREATE POLICY "Admin reads dsar cases" ON dsar_cases FOR SELECT
  USING (public.has_role('admin'));
CREATE POLICY "Admin updates dsar cases" ON dsar_cases FOR UPDATE
  USING (public.has_role('admin'));
-- consent_records
CREATE POLICY "Owner reads own consent" ON consent_records FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admin reads all consent" ON consent_records FOR SELECT
  USING (public.has_role('admin'));
-- listing_views
CREATE POLICY "Admin reads listing views" ON listing_views FOR SELECT
  USING (public.has_role('admin'));
-- ============================================================
-- SEED DATA: Plans
-- ============================================================

INSERT INTO plans (area, tier, name, price_cents, billing_frequency, features) VALUES
  ('MZANSI_MARKET', 'starter', 'Mzansi Market Starter', 10000, 'monthly', '{"listings_per_month": 5, "photos_per_listing": 5, "video_per_listing": false, "boost": false, "featured": false, "urgent": false}'),
  ('MZANSI_MARKET', 'growth', 'Mzansi Market Growth', 26000, 'monthly', '{"listings_per_month": 15, "photos_per_listing": 10, "video_per_listing": true, "boost": true, "featured": false, "urgent": false}'),
  ('MZANSI_MARKET', 'pro', 'Mzansi Market Pro', 45000, 'monthly', '{"listings_per_month": -1, "photos_per_listing": 10, "video_per_listing": true, "boost": true, "featured": true, "urgent": true}'),
  ('MALL_SHOPS', 'starter', 'Mall Shops Starter', 15000, 'monthly', '{"storefronts": 1, "posts_per_month": 4, "cover_video": false}'),
  ('MALL_SHOPS', 'growth', 'Mall Shops Growth', 36000, 'monthly', '{"storefronts": 3, "posts_per_month": 12, "cover_video": true}'),
  ('MALL_SHOPS', 'pro', 'Mall Shops Pro', 50000, 'monthly', '{"storefronts": -1, "posts_per_month": -1, "cover_video": true}'),
  ('BUSINESS_ADS', 'starter', 'Business Ads Starter', 9000, 'monthly', '{"profiles": 1, "posts_per_month": 4, "cover_video": false}'),
  ('BUSINESS_ADS', 'growth', 'Business Ads Growth', 26000, 'monthly', '{"profiles": 3, "posts_per_month": 12, "cover_video": true}'),
  ('BUSINESS_ADS', 'pro', 'Business Ads Pro', 45000, 'monthly', '{"profiles": -1, "posts_per_month": -1, "cover_video": true}');
