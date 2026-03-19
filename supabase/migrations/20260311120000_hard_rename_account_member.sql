-- Hard cutover from seller_* terminology to account/member terminology.
-- This migration removes the compatibility layer introduced earlier in the rollout.

-- Drop the compatibility view so the physical table can take over the canonical name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'account_profiles'
      AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW public.account_profiles';
  END IF;
END
$$;
-- Make the canonical verification column authoritative before removing legacy fields.
UPDATE public.seller_profiles
SET account_verification_status =
  COALESCE(
    account_verification_status,
    seller_verification_status::text::public.account_verification_status
  )
WHERE account_verification_status IS NULL;
DROP TRIGGER IF EXISTS sync_account_profile_verification_fields ON public.seller_profiles;
DROP FUNCTION IF EXISTS public.sync_account_profile_verification_fields();
DROP TRIGGER IF EXISTS sync_seller_profile_phone_fields ON public.seller_profiles;
DROP FUNCTION IF EXISTS public.sync_seller_profile_phone_fields();
ALTER TABLE public.seller_profiles
  ALTER COLUMN account_verification_status SET DEFAULT 'incomplete',
  ALTER COLUMN account_verification_status SET NOT NULL;
ALTER POLICY "Public reads live listings" ON public.listings
  USING (
    status = 'live'
    OR (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates listing" ON public.listings
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Owner or moderator updates listing" ON public.listings
  USING ((select auth.uid()) = owner_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes listing" ON public.listings
  USING ((select auth.uid()) = owner_id OR (select public.has_role('admin')));
ALTER POLICY "Public reads live storefronts" ON public.storefronts
  USING (
    status = 'live'
    OR (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates storefront" ON public.storefronts
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Owner or moderator updates storefront" ON public.storefronts
  USING ((select auth.uid()) = owner_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes storefront" ON public.storefronts
  USING ((select auth.uid()) = owner_id OR (select public.has_role('admin')));
ALTER POLICY "Public reads live business profiles" ON public.business_profiles
  USING (
    status = 'live'
    OR (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates business profile" ON public.business_profiles
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Owner or moderator updates business profile" ON public.business_profiles
  USING ((select auth.uid()) = owner_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes business profile" ON public.business_profiles
  USING ((select auth.uid()) = owner_id OR (select public.has_role('admin')));
ALTER POLICY "Public reads live storefront posts" ON public.storefront_posts
  USING (
    status = 'live'
    OR (select auth.uid()) = (
      select owner_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates storefront post" ON public.storefront_posts
  WITH CHECK (
    (select auth.uid()) = (
      select owner_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
  );
ALTER POLICY "Owner or moderator updates storefront post" ON public.storefront_posts
  USING (
    (select auth.uid()) = (
      select owner_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner or admin deletes storefront post" ON public.storefront_posts
  USING (
    (select auth.uid()) = (
      select owner_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
    OR (select public.has_role('admin'))
  );
ALTER POLICY "Public reads live business posts" ON public.business_posts
  USING (
    status = 'live'
    OR (select auth.uid()) = (
      select owner_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates business post" ON public.business_posts
  WITH CHECK (
    (select auth.uid()) = (
      select owner_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
  );
ALTER POLICY "Owner or moderator updates business post" ON public.business_posts
  USING (
    (select auth.uid()) = (
      select owner_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner or admin deletes business post" ON public.business_posts
  USING (
    (select auth.uid()) = (
      select owner_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
    OR (select public.has_role('admin'))
  );
ALTER POLICY "Public reads live businesses" ON public.businesses
  USING (status = 'live' OR auth.uid() = owner_id);
ALTER POLICY "Owner creates business" ON public.businesses
  WITH CHECK (auth.uid() = owner_id);
ALTER POLICY "Owner or moderator updates business" ON public.businesses
  USING (auth.uid() = owner_id OR public.has_any_role(ARRAY['moderator', 'admin']));
ALTER POLICY "Owner or admin deletes business" ON public.businesses
  USING (auth.uid() = owner_id OR public.has_role('admin'));
ALTER POLICY "Owners can view own promotions" ON public.promotions
  USING (auth.uid() = owner_id);
ALTER POLICY "Owners can create promotions" ON public.promotions
  WITH CHECK (auth.uid() = owner_id);
ALTER POLICY "Owners can update own promotions" ON public.promotions
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
ALTER POLICY "Owners can delete own draft promotions" ON public.promotions
  USING (auth.uid() = owner_id AND status IN ('draft', 'rejected'));
ALTER POLICY "Owner reads own leads" ON public.leads
  USING ((select auth.uid()) = owner_id OR (select public.has_role('admin')));
ALTER POLICY "Owner updates lead status" ON public.leads
  USING ((select auth.uid()) = owner_id);
DROP POLICY IF EXISTS leads_select_owner ON public.leads;
DROP TRIGGER IF EXISTS sync_listings_owner_fields ON public.listings;
DROP TRIGGER IF EXISTS sync_storefronts_owner_fields ON public.storefronts;
DROP TRIGGER IF EXISTS sync_storefront_posts_owner_fields ON public.storefront_posts;
DROP TRIGGER IF EXISTS sync_business_profiles_owner_fields ON public.business_profiles;
DROP TRIGGER IF EXISTS sync_business_posts_owner_fields ON public.business_posts;
DROP TRIGGER IF EXISTS sync_businesses_owner_fields ON public.businesses;
DROP TRIGGER IF EXISTS sync_promotions_owner_fields ON public.promotions;
DROP TRIGGER IF EXISTS sync_leads_owner_fields ON public.leads;
DROP TRIGGER IF EXISTS sync_contact_events_owner_fields ON public.contact_events;
DROP TRIGGER IF EXISTS sync_moderation_actions_target_owner_fields ON public.moderation_actions;
UPDATE public.listings SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.storefronts SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.storefront_posts SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.business_profiles SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.business_posts SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.businesses SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.promotions SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.leads SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.contact_events SET owner_id = seller_id WHERE owner_id IS NULL;
UPDATE public.moderation_actions
SET target_owner_id = target_seller_id
WHERE target_owner_id IS NULL;
ALTER TABLE public.listings ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.storefronts ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.storefront_posts ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.business_profiles ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.business_posts ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.businesses ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.promotions ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.leads ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.contact_events ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.contact_events
  RENAME COLUMN seller_verified TO member_verified;
ALTER INDEX IF EXISTS public.idx_contact_events_tcr
  RENAME TO idx_contact_events_member_tcr;
ALTER TABLE public.listings DROP COLUMN seller_id;
ALTER TABLE public.storefronts DROP COLUMN seller_id;
ALTER TABLE public.storefront_posts DROP COLUMN seller_id;
ALTER TABLE public.business_profiles DROP COLUMN seller_id;
ALTER TABLE public.business_posts DROP COLUMN seller_id;
ALTER TABLE public.businesses DROP COLUMN seller_id;
ALTER TABLE public.promotions DROP COLUMN seller_id;
ALTER TABLE public.leads DROP COLUMN seller_id;
ALTER TABLE public.contact_events DROP COLUMN seller_id;
ALTER TABLE public.moderation_actions DROP COLUMN target_seller_id;
DROP FUNCTION IF EXISTS public.sync_owner_id_with_seller_id();
DROP FUNCTION IF EXISTS public.sync_target_owner_id_with_target_seller_id();
ALTER TABLE public.seller_profiles
  DROP COLUMN seller_verification_status;
ALTER TABLE public.seller_profiles
  RENAME TO account_profiles;
ALTER INDEX IF EXISTS public.idx_seller_profiles_user_id
  RENAME TO idx_account_profiles_user_id;
ALTER INDEX IF EXISTS public.idx_seller_profiles_status
  RENAME TO idx_account_profiles_verification_status;
ALTER INDEX IF EXISTS public.idx_seller_profiles_account
  RENAME TO idx_account_profiles_account_status;
ALTER INDEX IF EXISTS public.idx_seller_profiles_unique_phone
  RENAME TO idx_account_profiles_unique_phone;
ALTER INDEX IF EXISTS public.idx_seller_profiles_phone
  RENAME TO idx_account_profiles_phone;
CREATE OR REPLACE FUNCTION public.sync_account_profile_phone_fields()
RETURNS TRIGGER AS $$
DECLARE
  conflicting_profile UUID;
BEGIN
  NEW.phone := public.normalize_sa_phone(NEW.phone);
  NEW.masked_phone_public := public.mask_phone_public(NEW.phone);

  IF NEW.phone IS NOT NULL THEN
    SELECT ap.id
    INTO conflicting_profile
    FROM public.account_profiles ap
    WHERE ap.phone = NEW.phone
      AND ap.id IS DISTINCT FROM NEW.id
    LIMIT 1;

    IF conflicting_profile IS NOT NULL THEN
      RAISE EXCEPTION 'Phone number already linked to another account'
        USING ERRCODE = '23505',
              CONSTRAINT = 'account_profiles_phone_unique';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sync_account_profile_phone_fields
  BEFORE INSERT OR UPDATE OF phone ON public.account_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_account_profile_phone_fields();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.account_profiles (
    user_id,
    display_name,
    account_verification_status,
    account_status
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'New Member'),
    'incomplete',
    'active'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION public.handle_new_user()
  SET search_path = pg_catalog, public;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_target_type_check
  CHECK (
    target_type IN (
      'listing',
      'storefront',
      'business_profile',
      'business',
      'promotion',
      'account_profile'
    )
  );
DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'retention_rejected_kyc_30d';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'retention_rejected_kyc_30d',
    '0 2 * * *',
    $cron$
      DELETE FROM kyc_artifacts
      WHERE status = 'rejected'
        AND created_at < NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1
          FROM account_profiles ap
          WHERE ap.user_id = kyc_artifacts.user_id
            AND ap.legal_hold = true
        );
    $cron$
  );

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'retention_contact_events_12mo';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'retention_contact_events_12mo',
    '30 2 * * *',
    $cron$
      DELETE FROM contact_events
      WHERE created_at < NOW() - INTERVAL '12 months'
        AND NOT EXISTS (
          SELECT 1
          FROM account_profiles ap
          WHERE ap.user_id = contact_events.owner_id
            AND ap.legal_hold = true
        );
    $cron$
  );

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'retention_audit_logs_24mo';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'retention_audit_logs_24mo',
    '50 2 * * *',
    $cron$
      DELETE FROM audit_logs
      WHERE created_at < NOW() - INTERVAL '24 months'
        AND NOT EXISTS (
          SELECT 1
          FROM account_profiles ap
          WHERE ap.user_id = audit_logs.actor_id
            AND ap.legal_hold = true
        );
    $cron$
  );

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'queue_r2_rejected_kyc_cleanup';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'queue_r2_rejected_kyc_cleanup',
    '55 2 * * *',
    $cron$
      INSERT INTO r2_cleanup_queue (bucket, r2_key, reason)
      SELECT 'private', r2_key, 'rejected_kyc_30d'
      FROM kyc_artifacts
      WHERE status = 'rejected'
        AND created_at < NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1
          FROM account_profiles ap
          WHERE ap.user_id = kyc_artifacts.user_id
            AND ap.legal_hold = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM r2_cleanup_queue cq
          WHERE cq.r2_key = kyc_artifacts.r2_key
            AND cq.processed_at IS NULL
        );
    $cron$
  );

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'queue_r2_approved_kyc_purge_30d';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'queue_r2_approved_kyc_purge_30d',
    '58 2 * * *',
    $cron$
      INSERT INTO r2_cleanup_queue (bucket, r2_key, reason)
      SELECT
        'verifymzansi-private',
        ka.r2_key,
        'approved_kyc_30d_purge'
      FROM kyc_artifacts ka
      WHERE ka.purge_after IS NOT NULL
        AND ka.purge_after < NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM account_profiles ap
          WHERE ap.user_id = ka.user_id
            AND ap.legal_hold = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM r2_cleanup_queue cq
          WHERE cq.r2_key = ka.r2_key
            AND cq.processed_at IS NULL
        );
    $cron$
  );
END
$$;
DROP TYPE IF EXISTS public.seller_verification_status;
