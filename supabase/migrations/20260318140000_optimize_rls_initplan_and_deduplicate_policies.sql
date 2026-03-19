-- ══════════════════════════════════════════════════════════════
-- Fix Supabase lint warnings:
--   0003  auth_rls_initplan          — wrap auth.*() in (select …)
--   0006  multiple_permissive_policies — drop legacy catch-all / merge SELECTs
--
-- Reference pattern established in:
--   20260223035000_optimize_rls_policy_eval.sql
-- ══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- PHASE 1: Fix auth_rls_initplan  (wrap auth calls in subselect)
-- ────────────────────────────────────────────────────────────

-- ── reports ─────────────────────────────────────────────────
ALTER POLICY "reports_insert_authenticated" ON public.reports
  WITH CHECK (reporter_user_id = (select auth.uid()));
-- ── r2_cleanup_queue ────────────────────────────────────────
ALTER POLICY "Service role full access on r2_cleanup_queue" ON public.r2_cleanup_queue
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
-- ── otp_challenges (service role — initplan fix only; merge in Phase 2) ──
ALTER POLICY "Service role full access on otp_challenges" ON public.otp_challenges
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
-- ── verification_sessions ───────────────────────────────────
ALTER POLICY "Owner reads own session" ON public.verification_sessions
  USING ((select auth.uid()) = user_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner writes own session" ON public.verification_sessions
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Owner updates own session" ON public.verification_sessions
  USING ((select auth.uid()) = user_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
-- ── free_posts_used ─────────────────────────────────────────
ALTER POLICY "Users can view own free_posts_used" ON public.free_posts_used
  USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own free_posts_used" ON public.free_posts_used
  WITH CHECK ((select auth.uid()) = user_id);
-- ── notifications ───────────────────────────────────────────
ALTER POLICY "Users can view own notifications" ON public.notifications
  USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own notifications" ON public.notifications
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own notifications" ON public.notifications
  USING ((select auth.uid()) = user_id);
ALTER POLICY "Service role can insert notifications" ON public.notifications
  WITH CHECK ((select auth.role()) = 'service_role');
-- ── promotions ──────────────────────────────────────────────
ALTER POLICY "Owners can create promotions" ON public.promotions
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Owners can update own promotions" ON public.promotions
  USING ((select auth.uid()) = owner_id)
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Owners can delete own draft promotions" ON public.promotions
  USING ((select auth.uid()) = owner_id AND status IN ('draft', 'rejected'));
-- ── businesses ──────────────────────────────────────────────
ALTER POLICY "Owner creates business" ON public.businesses
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY "Owner or moderator updates business" ON public.businesses
  USING ((select auth.uid()) = owner_id OR (select public.has_any_role(ARRAY['moderator', 'admin'])));
ALTER POLICY "Owner or admin deletes business" ON public.businesses
  USING ((select auth.uid()) = owner_id OR (select public.has_role('admin')));
-- ────────────────────────────────────────────────────────────
-- PHASE 2: Fix multiple_permissive_policies
-- ────────────────────────────────────────────────────────────

-- ── business_posts: drop legacy catch-all policies ──────────
-- These were created in 20260227000001 and superseded by
-- per-action named policies in 20260223035000/20260311120000.
DROP POLICY IF EXISTS business_posts_admin ON public.business_posts;
DROP POLICY IF EXISTS business_posts_public_read ON public.business_posts;
DROP POLICY IF EXISTS business_posts_owner ON public.business_posts;
-- ── storefront_posts: drop legacy catch-all policies ────────
DROP POLICY IF EXISTS storefront_posts_admin ON public.storefront_posts;
DROP POLICY IF EXISTS storefront_posts_public_read ON public.storefront_posts;
DROP POLICY IF EXISTS storefront_posts_owner ON public.storefront_posts;
-- ── businesses: merge two permissive SELECT policies into one ─
-- "Staff reads all businesses" + "Public reads live businesses"
-- → single policy matching pattern from optimize_rls_policy_eval
DROP POLICY IF EXISTS "Staff reads all businesses" ON public.businesses;
ALTER POLICY "Public reads live businesses" ON public.businesses
  USING (
    status = 'live'
    OR (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
  );
-- ── otp_challenges: merge admin SELECT into service-role policy ─
-- "Admin reads otp challenges" overlaps with "Service role full
-- access" on SELECT.  Merge admin check into the service-role
-- FOR ALL policy and drop the standalone admin SELECT.
DROP POLICY IF EXISTS "Admin reads otp challenges" ON public.otp_challenges;
ALTER POLICY "Service role full access on otp_challenges" ON public.otp_challenges
  USING ((select auth.role()) = 'service_role' OR (select public.has_role('admin')))
  WITH CHECK ((select auth.role()) = 'service_role' OR (select public.has_role('admin')));
-- ── promotions: merge two permissive SELECT policies into one ─
-- "Owners can view own promotions" + "Public can view live promotions"
-- → single SELECT policy (same pattern as listings/storefronts)
DROP POLICY IF EXISTS "Public can view live promotions" ON public.promotions;
ALTER POLICY "Owners can view own promotions" ON public.promotions
  USING (status = 'live' OR (select auth.uid()) = owner_id);
