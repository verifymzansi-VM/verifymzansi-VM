-- Optimize RLS policy evaluation and remove duplicate permissive SELECT policies.
-- Addresses performance lints:
-- - auth_rls_initplan
-- - multiple_permissive_policies

-- seller_profiles
ALTER POLICY "Owner reads own profile" ON public.seller_profiles
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));
ALTER POLICY "Owner creates profile" ON public.seller_profiles
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Owner or admin updates profile" ON public.seller_profiles
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));
-- verification_steps
ALTER POLICY "Owner reads own steps" ON public.verification_steps
  USING ((select auth.uid()) = user_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
-- kyc_artifacts
ALTER POLICY "Owner reads own artifacts" ON public.kyc_artifacts
  USING ((select auth.uid()) = user_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner uploads artifact" ON public.kyc_artifacts
  WITH CHECK ((select auth.uid()) = user_id);
-- listings
DROP POLICY IF EXISTS "Staff reads all listings" ON public.listings;
ALTER POLICY "Public reads live listings" ON public.listings
  USING (
    status = 'live'
    OR (select auth.uid()) = seller_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates listing" ON public.listings
  WITH CHECK ((select auth.uid()) = seller_id);
ALTER POLICY "Owner or moderator updates listing" ON public.listings
  USING ((select auth.uid()) = seller_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes listing" ON public.listings
  USING ((select auth.uid()) = seller_id OR (select public.has_role('admin')));
-- storefronts
DROP POLICY IF EXISTS "Staff reads all storefronts" ON public.storefronts;
ALTER POLICY "Public reads live storefronts" ON public.storefronts
  USING (
    status = 'live'
    OR (select auth.uid()) = seller_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates storefront" ON public.storefronts
  WITH CHECK ((select auth.uid()) = seller_id);
ALTER POLICY "Owner or moderator updates storefront" ON public.storefronts
  USING ((select auth.uid()) = seller_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes storefront" ON public.storefronts
  USING ((select auth.uid()) = seller_id OR (select public.has_role('admin')));
-- business_profiles
DROP POLICY IF EXISTS "Staff reads all business profiles" ON public.business_profiles;
ALTER POLICY "Public reads live business profiles" ON public.business_profiles
  USING (
    status = 'live'
    OR (select auth.uid()) = seller_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates business profile" ON public.business_profiles
  WITH CHECK ((select auth.uid()) = seller_id);
ALTER POLICY "Owner or moderator updates business profile" ON public.business_profiles
  USING ((select auth.uid()) = seller_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes business profile" ON public.business_profiles
  USING ((select auth.uid()) = seller_id OR (select public.has_role('admin')));
-- storefront_posts
DROP POLICY IF EXISTS "Staff reads all storefront posts" ON public.storefront_posts;
ALTER POLICY "Public reads live storefront posts" ON public.storefront_posts
  USING (
    status = 'live'
    OR (select auth.uid()) = (
      select seller_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates storefront post" ON public.storefront_posts
  WITH CHECK (
    (select auth.uid()) = (
      select seller_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
  );
ALTER POLICY "Owner or moderator updates storefront post" ON public.storefront_posts
  USING (
    (select auth.uid()) = (
      select seller_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner or admin deletes storefront post" ON public.storefront_posts
  USING (
    (select auth.uid()) = (
      select seller_id
      from public.storefronts
      where id = storefront_posts.storefront_id
    )
    OR (select public.has_role('admin'))
  );
-- business_posts
DROP POLICY IF EXISTS "Staff reads all business posts" ON public.business_posts;
ALTER POLICY "Public reads live business posts" ON public.business_posts
  USING (
    status = 'live'
    OR (select auth.uid()) = (
      select seller_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner creates business post" ON public.business_posts
  WITH CHECK (
    (select auth.uid()) = (
      select seller_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
  );
ALTER POLICY "Owner or moderator updates business post" ON public.business_posts
  USING (
    (select auth.uid()) = (
      select seller_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
ALTER POLICY "Owner or admin deletes business post" ON public.business_posts
  USING (
    (select auth.uid()) = (
      select seller_id
      from public.business_profiles
      where id = business_posts.business_profile_id
    )
    OR (select public.has_role('admin'))
  );
-- leads
DROP POLICY IF EXISTS "Admin reads all leads" ON public.leads;
ALTER POLICY "Owner reads own leads" ON public.leads
  USING ((select auth.uid()) = seller_id OR (select public.has_role('admin')));
ALTER POLICY "Owner updates lead status" ON public.leads
  USING ((select auth.uid()) = seller_id);
-- entitlements/payments/invoices
ALTER POLICY "Owner reads own entitlements" ON public.entitlements
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));
ALTER POLICY "Owner reads own payments" ON public.payments
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));
ALTER POLICY "Owner reads own invoices" ON public.invoices
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));
-- plans
DROP POLICY IF EXISTS "Admin manages plans" ON public.plans;
CREATE POLICY "Admin inserts plans" ON public.plans FOR INSERT
  WITH CHECK ((select public.has_role('admin')));
CREATE POLICY "Admin updates plans" ON public.plans FOR UPDATE
  USING ((select public.has_role('admin')))
  WITH CHECK ((select public.has_role('admin')));
CREATE POLICY "Admin deletes plans" ON public.plans FOR DELETE
  USING ((select public.has_role('admin')));
-- consent_records
DROP POLICY IF EXISTS "Admin reads all consent" ON public.consent_records;
ALTER POLICY "Owner reads own consent" ON public.consent_records
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));
-- r2_cleanup_queue
ALTER POLICY "Service role full access on r2_cleanup_queue" ON public.r2_cleanup_queue
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
