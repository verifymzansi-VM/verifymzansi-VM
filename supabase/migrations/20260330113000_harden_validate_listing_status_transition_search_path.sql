-- Harden trigger function search_path to satisfy Supabase Security Advisor
-- warning: Function Search Path Mutable.

ALTER FUNCTION public.validate_listing_status_transition()
  SET search_path = pg_catalog, public;
