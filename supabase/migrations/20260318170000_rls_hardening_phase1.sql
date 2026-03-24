-- ============================================================
-- RLS HARDENING: Phase 1 — Missing policies & defense-in-depth
-- Ticket: RLS audit 2026-03-18
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. promotions: Add moderator/admin SELECT
--    Current merged policy only allows: status = 'live' OR owner.
--    Moderators cannot see draft/pending/flagged promotions.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Staff reads all promotions"
  ON public.promotions
  FOR SELECT
  USING ((select public.has_any_role(ARRAY['moderator', 'admin'])));

-- ────────────────────────────────────────────────────────────
-- 2. consent_records: Explicit service_role INSERT + UPSERT
--    Consent writes must remain service-role-only for audit
--    integrity. Making this explicit instead of relying on
--    implicit service_role RLS bypass.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Service role writes consent records"
  ON public.consent_records
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY "Service role updates consent records"
  ON public.consent_records
  FOR UPDATE
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 3. listing_views: Explicit service_role INSERT
--    View tracking inserts happen via admin client; make the
--    policy explicit for defense-in-depth.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "Service role inserts listing views"
  ON public.listing_views
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 4. Storage bucket: avatars
--    Users upload to their own folder, public read.
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload/update their own avatar
CREATE POLICY "Users upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Public read for avatars (bucket is public)
CREATE POLICY "Public reads avatars"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');
