-- Fix advisor lint 0001: Unindexed foreign keys
-- Adds B-tree indexes on every FK column that lacks a covering index.
-- These speed up JOINs, CASCADE deletes, and ON UPDATE lookups.

-- business_profiles
CREATE INDEX IF NOT EXISTS idx_business_profiles_entitlement_id
  ON public.business_profiles (entitlement_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_owner_id
  ON public.business_profiles (owner_id);
-- businesses
CREATE INDEX IF NOT EXISTS idx_businesses_entitlement_id
  ON public.businesses (entitlement_id);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id
  ON public.businesses (owner_id);
-- contact_events
CREATE INDEX IF NOT EXISTS idx_contact_events_owner_id
  ON public.contact_events (owner_id);
-- dsar_cases
CREATE INDEX IF NOT EXISTS idx_dsar_cases_processed_by
  ON public.dsar_cases (processed_by);
-- feature_flags
CREATE INDEX IF NOT EXISTS idx_feature_flags_updated_by
  ON public.feature_flags (updated_by);
-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_payment_id
  ON public.invoices (payment_id);
-- leads
CREATE INDEX IF NOT EXISTS idx_leads_owner_id
  ON public.leads (owner_id);
-- listings
CREATE INDEX IF NOT EXISTS idx_listings_entitlement_id
  ON public.listings (entitlement_id);
CREATE INDEX IF NOT EXISTS idx_listings_owner_id
  ON public.listings (owner_id);
-- payments
CREATE INDEX IF NOT EXISTS idx_payments_entitlement_id
  ON public.payments (entitlement_id);
-- promotions
CREATE INDEX IF NOT EXISTS idx_promotions_entitlement_id
  ON public.promotions (entitlement_id);
CREATE INDEX IF NOT EXISTS idx_promotions_owner_id
  ON public.promotions (owner_id);
-- reports
CREATE INDEX IF NOT EXISTS idx_reports_assigned_to
  ON public.reports (assigned_to);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_user_id
  ON public.reports (reporter_user_id);
-- storefronts
CREATE INDEX IF NOT EXISTS idx_storefronts_entitlement_id
  ON public.storefronts (entitlement_id);
CREATE INDEX IF NOT EXISTS idx_storefronts_owner_id
  ON public.storefronts (owner_id);
-- verification_sessions
CREATE INDEX IF NOT EXISTS idx_verification_sessions_id_artifact_id
  ON public.verification_sessions (id_artifact_id);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_selfie_artifact_id
  ON public.verification_sessions (selfie_artifact_id);
-- verification_steps
CREATE INDEX IF NOT EXISTS idx_verification_steps_reviewed_by
  ON public.verification_steps (reviewed_by);
