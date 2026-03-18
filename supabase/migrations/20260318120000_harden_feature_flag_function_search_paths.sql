-- Address Supabase Security Advisor lint 0007: Function Search Path Mutable
-- Both feature-flag trigger functions were created with SET search_path = public
-- but need pg_catalog prefix to prevent search-path injection in SECURITY DEFINER context.

ALTER FUNCTION public.update_feature_flag_timestamp()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.log_feature_flag_change()
  SET search_path = pg_catalog, public;
