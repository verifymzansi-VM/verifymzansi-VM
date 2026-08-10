-- Security hardening: normalize search_path on all SECURITY DEFINER functions.
--
-- A number of SECURITY DEFINER functions were created with `SET search_path = public`
-- (omitting pg_catalog) or with no SET search_path at all. The project standard is
-- `pg_catalog, public` to prevent search-path injection / object-shadowing attacks.
--
-- Rather than hardcoding signatures (many functions are re-created across migrations,
-- so a static list risks stale signatures), this migration discovers every SECURITY
-- DEFINER function in the public schema whose effective search_path is not the
-- hardened value and re-applies the correct setting via ALTER FUNCTION.
--
-- Idempotent: safe to re-run; functions already hardened are skipped.

DO $$
DECLARE
  fn RECORD;
  hardened CONSTANT TEXT := 'pg_catalog, public';
BEGIN
  FOR fn IN
    SELECT
      p.proname AS func_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = TRUE  -- SECURITY DEFINER only
      AND (
        -- No search_path set at all, OR set to something other than the hardened value
        NOT EXISTS (
          SELECT 1
          FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
          WHERE cfg LIKE 'search_path=%'
        )
        OR EXISTS (
          SELECT 1
          FROM unnest(p.proconfig) AS cfg
          WHERE cfg LIKE 'search_path=%'
            AND cfg <> 'search_path=' || hardened
            AND cfg <> 'search_path=' || hardened || ' '
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = %s',
      fn.func_name,
      fn.identity_args,
      hardened
    );
  END LOOP;
END $$;

-- Explicitly harden lookup_buyer_verification (L9) — SECURITY DEFINER with no
-- search_path set in the initial schema. Covered by the loop above, but asserted
-- here for clarity and to guarantee the exact signature is addressed.
ALTER FUNCTION public.lookup_buyer_verification(UUID)
  SET search_path = pg_catalog, public;
