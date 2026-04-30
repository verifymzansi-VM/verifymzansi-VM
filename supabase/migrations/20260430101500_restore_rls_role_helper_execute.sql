-- Restore execute privileges for role helpers used inside RLS policies.
--
-- The direct-RPC hardening migration revoked EXECUTE from authenticated users
-- for all SECURITY DEFINER helpers. `has_role` and `has_any_role` are also
-- evaluated by RLS policies, so authenticated/anon roles need permission to
-- execute them while querying protected tables.

BEGIN;

GRANT EXECUTE ON FUNCTION public.has_role(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO anon, authenticated;

COMMIT;
