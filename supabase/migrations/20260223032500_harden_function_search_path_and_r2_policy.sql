-- Harden function search_path and tighten cleanup queue RLS policy.
-- Addresses Supabase Security Advisor warnings:
-- - Function Search Path Mutable (multiple public functions)
-- - RLS Policy Always True on public.r2_cleanup_queue

ALTER FUNCTION public.has_role(TEXT)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.has_any_role(TEXT[])
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.listings_search_update()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.storefronts_search_update()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.business_profiles_search_update()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.lookup_buyer_verification(UUID)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.handle_new_user()
  SET search_path = pg_catalog, public;
DROP POLICY IF EXISTS "Service role full access on r2_cleanup_queue"
  ON public.r2_cleanup_queue;
CREATE POLICY "Service role full access on r2_cleanup_queue"
  ON public.r2_cleanup_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
