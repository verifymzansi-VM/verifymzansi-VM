-- Fix Supabase Security Advisor warning: Function Search Path Mutable
-- on public.sync_account_profile_phone_fields
-- Set search_path to prevent search-path injection.

ALTER FUNCTION public.sync_account_profile_phone_fields()
  SET search_path = pg_catalog, public;
