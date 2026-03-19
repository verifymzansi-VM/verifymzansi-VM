-- Address Supabase Security Advisor warnings:
-- - Function Search Path Mutable
-- - RLS Policy Always True on public.notifications

ALTER FUNCTION public.update_promotions_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.businesses_search_update()
  SET search_path = pg_catalog, public;
DROP POLICY IF EXISTS "Service role can insert notifications"
  ON public.notifications;
CREATE POLICY "Service role can insert notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
