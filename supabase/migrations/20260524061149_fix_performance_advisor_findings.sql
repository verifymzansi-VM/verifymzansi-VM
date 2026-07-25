-- Supabase Performance Advisor cleanup, 2026-05-24.
--
-- Fixes:
-- - missing indexes for five foreign keys
-- - RLS policies that re-evaluate auth helpers per row
-- - duplicate permissive SELECT/INSERT policies
-- - unused non-FK indexes reported by the advisor
--
-- Some "unused" indexes are intentionally retained because they are the
-- covering indexes for foreign keys; dropping them would trade one advisor
-- finding for a more important unindexed-foreign-key finding.

-- ---------------------------------------------------------------------
-- 1. Cover foreign keys that the advisor flagged as unindexed.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_appeal_cases_appellant_id
  ON public.appeal_cases (appellant_id);

CREATE INDEX IF NOT EXISTS idx_appeal_cases_reviewer_id
  ON public.appeal_cases (reviewer_id);

CREATE INDEX IF NOT EXISTS idx_content_edit_requests_reviewed_by
  ON public.content_edit_requests (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_decision_records_parent_decision_id
  ON public.decision_records (parent_decision_id);

CREATE INDEX IF NOT EXISTS idx_decision_records_secondary_approver_id
  ON public.decision_records (secondary_approver_id);

-- ---------------------------------------------------------------------
-- 2. Rewrite RLS policies to cache auth lookups and avoid broad roles.
-- ---------------------------------------------------------------------

ALTER POLICY "Users manage own drafts"
  ON public.listing_drafts
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owner reads own contact changes"
  ON public.contact_change_history;
DROP POLICY IF EXISTS "Admin reads contact changes"
  ON public.contact_change_history;
DROP POLICY IF EXISTS "Service role manages contact changes"
  ON public.contact_change_history;

CREATE POLICY "contact_change_history_select"
  ON public.contact_change_history
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    OR (select public.has_role('admin'))
  );

CREATE POLICY "contact_change_history_service_role_all"
  ON public.contact_change_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Owner reads own profile changes"
  ON public.profile_change_history;
DROP POLICY IF EXISTS "Service role manages profile changes"
  ON public.profile_change_history;

CREATE POLICY "profile_change_history_select"
  ON public.profile_change_history
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "profile_change_history_service_role_all"
  ON public.profile_change_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS media_uploads_select
  ON public.media_uploads;
DROP POLICY IF EXISTS media_uploads_insert
  ON public.media_uploads;
DROP POLICY IF EXISTS media_uploads_service_all
  ON public.media_uploads;

CREATE POLICY media_uploads_select
  ON public.media_uploads
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY media_uploads_insert
  ON public.media_uploads
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY media_uploads_service_all
  ON public.media_uploads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Owner reads own content edit requests"
  ON public.content_edit_requests;
DROP POLICY IF EXISTS "Staff reads all content edit requests"
  ON public.content_edit_requests;

CREATE POLICY "content_edit_requests_select"
  ON public.content_edit_requests
  FOR SELECT
  TO authenticated
  USING (
    owner_id = (select auth.uid())
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );

DROP POLICY IF EXISTS "Staff updates content edit requests"
  ON public.content_edit_requests;

CREATE POLICY "Staff updates content edit requests"
  ON public.content_edit_requests
  FOR UPDATE
  TO authenticated
  USING ((select public.has_any_role(ARRAY['moderator', 'admin'])))
  WITH CHECK ((select public.has_any_role(ARRAY['moderator', 'admin'])));

DROP POLICY IF EXISTS "Staff reads all promotions"
  ON public.promotions;

DROP POLICY IF EXISTS "Owners can view own promotions"
  ON public.promotions;

CREATE POLICY "Owners can view own promotions"
  ON public.promotions
  FOR SELECT
  TO public
  USING (
    (
      status = 'live'
      AND expires_at > now()
    )
    OR (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );

DROP POLICY IF EXISTS "staff_read_decision_records"
  ON public.decision_records;
DROP POLICY IF EXISTS "staff_read_decision_events"
  ON public.decision_record_events;
DROP POLICY IF EXISTS "staff_read_appeal_cases"
  ON public.appeal_cases;
DROP POLICY IF EXISTS "staff_read_role_history"
  ON public.role_assignments_history;

CREATE POLICY "staff_read_decision_records"
  ON public.decision_records
  FOR SELECT
  TO authenticated
  USING ((select public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin'])));

CREATE POLICY "staff_read_decision_events"
  ON public.decision_record_events
  FOR SELECT
  TO authenticated
  USING ((select public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin'])));

CREATE POLICY "staff_read_appeal_cases"
  ON public.appeal_cases
  FOR SELECT
  TO authenticated
  USING ((select public.has_any_role(ARRAY['governance_controller', 'admin'])));

CREATE POLICY "staff_read_role_history"
  ON public.role_assignments_history
  FOR SELECT
  TO authenticated
  USING ((select public.has_any_role(ARRAY['governance_controller', 'admin'])));

-- ---------------------------------------------------------------------
-- 3. Remove unused indexes that do not cover foreign keys.
-- ---------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_audit_logs_actor;
DROP INDEX IF EXISTS public.idx_business_profiles_search;
DROP INDEX IF EXISTS public.idx_businesses_boost;
DROP INDEX IF EXISTS public.idx_businesses_expired_delete;
DROP INDEX IF EXISTS public.idx_businesses_search;
DROP INDEX IF EXISTS public.idx_businesses_urgent;
DROP INDEX IF EXISTS public.idx_buyer_verifications_expiry;
DROP INDEX IF EXISTS public.idx_contact_events_tcr;
DROP INDEX IF EXISTS public.idx_content_edit_requests_queue;
DROP INDEX IF EXISTS public.idx_decision_events_decision;
DROP INDEX IF EXISTS public.idx_decision_records_case;
DROP INDEX IF EXISTS public.idx_decision_records_correlation;
DROP INDEX IF EXISTS public.idx_dsar_due;
DROP INDEX IF EXISTS public.idx_dsar_status;
DROP INDEX IF EXISTS public.idx_entitlements_trial;
DROP INDEX IF EXISTS public.idx_kyc_artifacts_phash;
DROP INDEX IF EXISTS public.idx_listing_views_target;
DROP INDEX IF EXISTS public.idx_listings_area_status_created;
DROP INDEX IF EXISTS public.idx_listings_expired_delete;
DROP INDEX IF EXISTS public.idx_listings_price;
DROP INDEX IF EXISTS public.idx_listings_search;
DROP INDEX IF EXISTS public.idx_media_uploads_orphan;
DROP INDEX IF EXISTS public.idx_notifications_created_at;
DROP INDEX IF EXISTS public.idx_otp_challenges_locked_until;
DROP INDEX IF EXISTS public.idx_otp_logs_provider_message_id;
DROP INDEX IF EXISTS public.idx_promotions_boost;
DROP INDEX IF EXISTS public.idx_promotions_expired_delete;
DROP INDEX IF EXISTS public.idx_promotions_featured;
DROP INDEX IF EXISTS public.idx_promotions_social_distribution_authorized;
DROP INDEX IF EXISTS public.idx_promotions_social_distribution_revoked_at;
DROP INDEX IF EXISTS public.idx_promotions_urgent;
DROP INDEX IF EXISTS public.idx_reports_severity;
DROP INDEX IF EXISTS public.idx_storefronts_province_city;
DROP INDEX IF EXISTS public.idx_storefronts_search;
DROP INDEX IF EXISTS public.idx_verification_steps_phone_verified;
