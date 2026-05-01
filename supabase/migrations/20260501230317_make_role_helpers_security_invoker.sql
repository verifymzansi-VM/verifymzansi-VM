-- These helpers only read the caller's JWT claims, so they do not need
-- elevated privileges. Keeping them invoker-mode removes exposed
-- SECURITY DEFINER RPC surface while preserving RLS policy behavior.

CREATE OR REPLACE FUNCTION public.has_role(required_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = required_role, false);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = ANY(roles), false);
$$;

GRANT EXECUTE ON FUNCTION public.has_role(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(TEXT[]) TO anon, authenticated, service_role;
