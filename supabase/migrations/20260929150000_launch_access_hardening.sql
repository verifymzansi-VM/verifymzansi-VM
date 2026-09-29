-- Pre-launch access hardening from the final backend audit.
--
-- The anon key is public, so every table grant below is reachable directly
-- through PostgREST by any signed-in person, not only through our API routes.
-- The app performs these writes with the service role, so each change here
-- only removes a path the app never used.
--
--  1. KYC retention. The nightly rejected-KYC purge failed whenever staff had
--     viewed the artifact (access-log FK), queued R2 deletes only after the
--     rows were already gone, and re-queued every purged approved artifact
--     forever. One function now deletes rows (a delete trigger queues the
--     object), marks approved artifacts purged once, and removes abandoned
--     uploads. Evidence access logs outlive the artifact and the staff actor.
--  2. account_profiles: length checks mirror the API validation. Removing
--     owner write access is a separate migration (20260929150100) because it
--     must follow the deploy that moves profile writes server-side.
--  3. Content tables: direct INSERT skipped posting limits, payment and the
--     paid add-on guards. Owners also could rewrite live content directly,
--     or edit hidden/expired/sold content and reactivate it without review.
--  4. Staff write policies: staff powers over PostgREST skipped the MFA the
--     admin routes require, and moderators could rewrite a pending edit's
--     proposed_data before it was applied with the service role. Every staff
--     write goes through a service-role route, so the staff branches go.
--  5. Verification records (artifacts, sessions, steps, signals, provider
--     results) are written server-side only.
--  6. Leads: owners may only change a lead's status.
--  7. Paid add-ons: expose active_* computed fields so ranking ignores
--     expired boosts, featured and urgent windows.
--  8. Events: cap an event's span and how far ahead it can end.
--  9. Functions: slot_entitlement_usable reads now() and must not be
--     IMMUTABLE; pin search_path on the remaining helpers; the trigger-only
--     function is not callable over the API; public stats skip expired posts.
-- 10. Index the foreign keys flagged by the performance advisor.

BEGIN;

-- 1. KYC retention -----------------------------------------------------------
ALTER TABLE public.kyc_evidence_access_logs
  ALTER COLUMN artifact_id DROP NOT NULL,
  ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.kyc_evidence_access_logs
  DROP CONSTRAINT IF EXISTS kyc_evidence_access_logs_artifact_id_fkey,
  DROP CONSTRAINT IF EXISTS kyc_evidence_access_logs_actor_id_fkey;
ALTER TABLE public.kyc_evidence_access_logs
  ADD CONSTRAINT kyc_evidence_access_logs_artifact_id_fkey
    FOREIGN KEY (artifact_id) REFERENCES public.kyc_artifacts(id) ON DELETE SET NULL,
  ADD CONSTRAINT kyc_evidence_access_logs_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Approved artifacts keep their row (hashes feed duplicate detection) after
-- the stored document is deleted.
ALTER TABLE public.kyc_artifacts ADD COLUMN IF NOT EXISTS purged_at timestamptz;

CREATE OR REPLACE FUNCTION public.queue_kyc_artifact_object_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.purged_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.r2_cleanup_queue q
    WHERE q.r2_key = OLD.r2_key AND q.processed_at IS NULL
  ) THEN
    INSERT INTO public.r2_cleanup_queue (bucket, r2_key, reason)
    VALUES ('private', OLD.r2_key, 'kyc_artifact_deleted');
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_kyc_artifact_object_cleanup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS queue_kyc_artifact_object_cleanup ON public.kyc_artifacts;
CREATE TRIGGER queue_kyc_artifact_object_cleanup AFTER DELETE ON public.kyc_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.queue_kyc_artifact_object_cleanup();

CREATE OR REPLACE FUNCTION public.run_kyc_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rejected integer;
  v_abandoned integer;
  v_purged integer;
BEGIN
  -- Rejected and superseded evidence, 30 days after upload.
  DELETE FROM public.kyc_artifacts ka
  WHERE ka.status = 'rejected'
    AND ka.created_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                    WHERE ap.user_id = ka.user_id AND ap.legal_hold);
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  -- Uploads that never reached review and are no longer attached to a session.
  DELETE FROM public.kyc_artifacts ka
  WHERE ka.status IN ('pending', 'needs_resubmission')
    AND ka.created_at < now() - interval '90 days'
    AND NOT EXISTS (SELECT 1 FROM public.verification_sessions s
                    WHERE s.id_artifact_id = ka.id OR s.selfie_artifact_id = ka.id)
    AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                    WHERE ap.user_id = ka.user_id AND ap.legal_hold);
  GET DIAGNOSTICS v_abandoned = ROW_COUNT;

  -- Approved evidence past its purge date: delete the document once.
  WITH purged AS (
    UPDATE public.kyc_artifacts ka
    SET purged_at = now()
    WHERE ka.purge_after IS NOT NULL
      AND ka.purge_after < now()
      AND ka.purged_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                      WHERE ap.user_id = ka.user_id AND ap.legal_hold)
    RETURNING ka.r2_key
  )
  INSERT INTO public.r2_cleanup_queue (bucket, r2_key, reason)
  SELECT DISTINCT 'private', p.r2_key, 'approved_kyc_30d_purge'
  FROM purged p
  WHERE NOT EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
                    WHERE q.r2_key = p.r2_key AND q.processed_at IS NULL);
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object('rejected', v_rejected, 'abandoned', v_abandoned, 'purged', v_purged);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.run_kyc_retention() FROM PUBLIC, anon, authenticated;

-- Artifacts already queued by the old approved-purge job are purged.
UPDATE public.kyc_artifacts ka SET purged_at = now()
WHERE ka.purged_at IS NULL
  AND ka.purge_after < now()
  AND EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
              WHERE q.r2_key = ka.r2_key AND q.reason = 'approved_kyc_30d_purge');

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
    WHERE jobname IN ('retention_rejected_kyc_30d', 'queue_r2_rejected_kyc_cleanup',
                      'queue_r2_approved_kyc_purge_30d', 'kyc_retention_daily');
    PERFORM cron.schedule('kyc_retention_daily', '0 2 * * *', 'SELECT public.run_kyc_retention()');
  END IF;
END;
$$;

-- 2. account_profiles: length checks mirror the API validation. (Owner write
--    access is removed in 20260929150100 once the routes write server-side.)
ALTER TABLE public.account_profiles
  ADD CONSTRAINT account_profiles_display_name_length
    CHECK (display_name IS NULL OR char_length(display_name) <= 80),
  ADD CONSTRAINT account_profiles_bio_length
    CHECK (bio IS NULL OR char_length(bio) <= 500),
  ADD CONSTRAINT account_profiles_location_length
    CHECK (char_length(coalesce(location_province, '')) <= 100
       AND char_length(coalesce(location_city, '')) <= 100);

-- 3. Content tables --------------------------------------------------------------
REVOKE INSERT ON public.listings, public.businesses, public.promotions FROM anon, authenticated;
DROP POLICY IF EXISTS "Owner creates listing" ON public.listings;
DROP POLICY IF EXISTS "Owner creates business" ON public.businesses;
DROP POLICY IF EXISTS "Owners can create promotions" ON public.promotions;

-- Set when an owner edits content that was approved before (hidden, expired,
-- sold...). Such content goes back to review instead of straight to live.
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS edited_since_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS edited_since_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS edited_since_review boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_owner_content_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Bookkeeping and presentation-only fields (image crop and dimensions).
  review_exempt text[] := ARRAY['status', 'updated_at', 'search_vector', 'edited_since_review',
                                'focal_x', 'focal_y', 'media_width', 'media_height'];
  content_changed boolean :=
    (to_jsonb(NEW) - review_exempt) IS DISTINCT FROM (to_jsonb(OLD) - review_exempt);
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    -- Moderation approval clears the flag; nothing else touches it.
    IF NEW.status::text = 'live'
       AND OLD.status::text IN ('pending_moderation', 'flagged_for_review') THEN
      NEW.edited_since_review := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.edited_since_review IS DISTINCT FROM OLD.edited_since_review
     OR to_jsonb(NEW)->'entitlement_id' IS DISTINCT FROM to_jsonb(OLD)->'entitlement_id'
     OR to_jsonb(NEW)->'status_reason' IS DISTINCT FROM to_jsonb(OLD)->'status_reason' THEN
    RAISE EXCEPTION 'edited_since_review, entitlement_id and status_reason are set by system workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF content_changed THEN
    -- Approved content changes only through the content edit review. Status
    -- moves (hide, mark sold) stay subject to validate_listing_status_transition.
    IF OLD.status::text = 'live' THEN
      RAISE EXCEPTION 'Live content changes must go through edit review'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status::text NOT IN ('draft', 'pending_moderation', 'rejected') THEN
      NEW.edited_since_review := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_owner_content_edits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_owner_content_edits ON public.listings;
CREATE TRIGGER guard_owner_content_edits BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_content_edits();
DROP TRIGGER IF EXISTS guard_owner_content_edits ON public.businesses;
CREATE TRIGGER guard_owner_content_edits BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_content_edits();
DROP TRIGGER IF EXISTS guard_owner_content_edits ON public.promotions;
CREATE TRIGGER guard_owner_content_edits BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_content_edits();

CREATE OR REPLACE FUNCTION public.owner_content_action(p_user uuid, p_table text, p_content uuid, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE content jsonb; st text; claim public.intro_trial_claims; n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
 IF p_table NOT IN ('listings','businesses','promotions') THEN RAISE EXCEPTION 'Unknown content type'; END IF;
 EXECUTE format('SELECT to_jsonb(p) FROM public.%I p WHERE id = $1 FOR UPDATE',p_table) INTO content USING p_content;
 IF content IS NULL OR (content->>'owner_id')::uuid IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND: Content not found'; END IF;
 st := content->>'status';
 IF p_action = 'mark_sold' THEN
  IF st <> 'live' THEN RAISE EXCEPTION 'CONTENT_STATE: Only live posts can be marked as sold'; END IF;
  EXECUTE format('UPDATE public.%I SET status = ''sold'', status_reason = ''Marked as sold by owner'' WHERE id = $1',p_table) USING p_content;
  RETURN 'sold';
 ELSIF p_action = 'deactivate' THEN
  IF st <> 'live' THEN RAISE EXCEPTION 'CONTENT_STATE: Only live posts can be deactivated'; END IF;
  EXECUTE format('UPDATE public.%I SET status = ''hidden'', status_reason = ''Deactivated by owner'' WHERE id = $1',p_table) USING p_content;
  RETURN 'hidden';
 ELSIF p_action = 'reactivate' THEN
  IF st NOT IN ('expired','sold') AND NOT (st = 'hidden' AND content->>'status_reason' = 'Deactivated by owner') THEN
   RAISE EXCEPTION 'CONTENT_STATE: This post cannot be reactivated in its current state';
  END IF;
  IF (content->>'end_date')::timestamptz <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  -- Content edited since it was approved goes back to review first.
  IF (content->>'edited_since_review')::boolean THEN
   EXECUTE format('UPDATE public.%I SET status = ''pending_moderation'', status_reason = NULL WHERE id = $1',p_table) USING p_content;
   RETURN 'pending_moderation';
  END IF;
  SELECT * INTO claim FROM public.intro_trial_claims WHERE content_id = p_content FOR UPDATE;
  IF claim.id IS NOT NULL AND claim.converted_at IS NULL THEN
   UPDATE public.intro_trial_claims SET converted_at = now(), released_at = COALESCE(released_at,now()), release_reason = COALESCE(release_reason,'paid_renewal') WHERE id = claim.id;
  END IF;
  -- Unchanged, previously approved content goes straight back to live; the
  -- publication trigger activates a slot or raises SLOT_FULL / TRIAL_REQUIRED.
  EXECUTE format('UPDATE public.%I SET status = ''live'', status_reason = NULL WHERE id = $1',p_table) USING p_content;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN 'live';
 END IF;
 RAISE EXCEPTION 'Unknown content action';
END;
$$;

-- 4. Staff write branches ----------------------------------------------------
DROP POLICY IF EXISTS "Owner or moderator updates listing" ON public.listings;
CREATE POLICY "Owner updates listing" ON public.listings
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Owner or admin deletes listing" ON public.listings;
CREATE POLICY "Owner deletes listing" ON public.listings
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owner or moderator updates business" ON public.businesses;
CREATE POLICY "Owner updates business" ON public.businesses
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Owner or admin deletes business" ON public.businesses;
CREATE POLICY "Owner deletes business" ON public.businesses
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Staff updates content edit requests" ON public.content_edit_requests;
DROP POLICY IF EXISTS "Admin updates dsar cases" ON public.dsar_cases;
DROP POLICY IF EXISTS "Admins can insert feature flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admins can update feature flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admins can delete feature flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admin inserts plans" ON public.plans;
DROP POLICY IF EXISTS "Admin updates plans" ON public.plans;
DROP POLICY IF EXISTS "Admin deletes plans" ON public.plans;
DROP POLICY IF EXISTS "Service role full access on otp_challenges" ON public.otp_challenges;
REVOKE INSERT, UPDATE, DELETE ON public.content_edit_requests, public.dsar_cases,
  public.feature_flags, public.plans, public.otp_challenges FROM anon, authenticated;

-- 5. Verification records are written server-side only -------------------------
REVOKE INSERT, UPDATE, DELETE ON public.kyc_artifacts, public.verification_sessions,
  public.verification_steps, public.kyc_risk_signals, public.kyc_provider_results,
  public.kyc_evidence_access_logs FROM anon, authenticated;
DROP POLICY IF EXISTS "Owner uploads artifact" ON public.kyc_artifacts;
DROP POLICY IF EXISTS "Owner writes own session" ON public.verification_sessions;

-- 6. Leads: owners manage status only -------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.leads FROM anon, authenticated;
GRANT UPDATE (status) ON public.leads TO authenticated;

-- 7. Active paid add-on windows (PostgREST computed fields) ------------------
CREATE OR REPLACE FUNCTION public.active_boost_until(public.listings)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN $1.boost_until > now() THEN $1.boost_until END $$;
CREATE OR REPLACE FUNCTION public.active_featured_until(public.listings)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN $1.featured_until > now() THEN $1.featured_until END $$;
CREATE OR REPLACE FUNCTION public.active_boost_until(public.businesses)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN $1.boost_until > now() THEN $1.boost_until END $$;
CREATE OR REPLACE FUNCTION public.active_featured_until(public.businesses)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN $1.featured_until > now() THEN $1.featured_until END $$;
CREATE OR REPLACE FUNCTION public.active_boost_until(public.promotions)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN $1.boost_until > now() THEN $1.boost_until END $$;
CREATE OR REPLACE FUNCTION public.active_featured_until(public.promotions)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT CASE WHEN $1.featured_until > now() THEN $1.featured_until END $$;

-- 8. Events: bounded span and end date ---------------------------------------
ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_event_window
    CHECK (end_date IS NULL
       OR ((start_date IS NULL OR end_date <= start_date + interval '90 days')
           AND end_date <= created_at + interval '400 days'));

-- 9. Functions -----------------------------------------------------------------
ALTER FUNCTION public.slot_entitlement_usable(public.slot_entitlements) STABLE;
ALTER FUNCTION public.slot_entitlement_usable(public.slot_entitlements)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.organisation_is_listed(public.organisations)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.affiliation_label(text, text)
  SET search_path = pg_catalog, public;
REVOKE EXECUTE ON FUNCTION public.slot_entitlements_sync_trigger() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.organisation_public_stats(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
 SELECT jsonb_build_object(
  'affiliatedCount', (SELECT count(*) FROM public.organisation_affiliations f
    JOIN public.businesses b ON b.id = f.business_id
    WHERE f.organisation_id = p_org AND f.status = 'active' AND b.status = 'live'
      AND (b.expires_at IS NULL OR b.expires_at > now())),
  'sponsoredCount', (SELECT count(*) FROM public.organisation_sponsorships
    WHERE organisation_id = p_org AND status = 'active'));
$$;

-- 10. Foreign-key indexes ------------------------------------------------------
CREATE INDEX IF NOT EXISTS account_acquisition_organisation_idx
  ON public.account_acquisition (organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_contracts_organisation_idx
  ON public.commercial_contracts (organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisation_affiliations_application_idx
  ON public.organisation_affiliations (application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisation_affiliations_programme_idx
  ON public.organisation_affiliations (programme_id) WHERE programme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisation_applications_applicant_idx
  ON public.organisation_applications (applicant_id);
CREATE INDEX IF NOT EXISTS organisation_applications_business_idx
  ON public.organisation_applications (business_id);
CREATE INDEX IF NOT EXISTS organisation_applications_programme_idx
  ON public.organisation_applications (programme_id) WHERE programme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisation_notes_organisation_idx
  ON public.organisation_notes (organisation_id);
CREATE INDEX IF NOT EXISTS organisation_sponsorships_business_idx
  ON public.organisation_sponsorships (business_id);
CREATE INDEX IF NOT EXISTS organisation_sponsorships_slot_entitlement_idx
  ON public.organisation_sponsorships (slot_entitlement_id) WHERE slot_entitlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisations_contract_idx
  ON public.organisations (contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS programme_showcases_organisation_idx
  ON public.programme_showcases (organisation_id);
CREATE INDEX IF NOT EXISTS programme_showcases_programme_idx
  ON public.programme_showcases (programme_id) WHERE programme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS slot_entitlements_plan_idx
  ON public.slot_entitlements (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS slot_entitlements_sponsorship_idx
  ON public.slot_entitlements (sponsorship_id) WHERE sponsorship_id IS NOT NULL;

COMMIT;
