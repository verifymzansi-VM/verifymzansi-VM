-- Global category availability for GET /api/businesses?categories_only=true.
-- Other browse filters intentionally do not scope this discovery count.
-- Aggregate in PostgreSQL so PostgREST row limits cannot truncate totals.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_business_category_counts(
  p_hide_fixtures boolean DEFAULT false
)
RETURNS TABLE(category text, count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT b.category::text, count(*)
  FROM public.businesses b
  WHERE b.status = 'live'
    AND b.area IN ('MZANSI_BUSINESS', 'PROMOTIONS_EVENTS')
    -- Keep aligned with applyVisibleExpiryFilter and FREE_POST_CONFIG (7 days).
    AND (b.expires_at > now()
      OR (b.expires_at IS NULL AND b.created_at > now() - interval '7 days'))
    AND NOT public.is_placeholder_content(b.business_name, b.description)
    -- Hosted owners are UUIDs; local Playwright fixtures use pw-* identifiers.
    AND (NOT coalesce(p_hide_fixtures, false)
      OR b.owner_id::text !~ '^pw-[A-Za-z0-9-]+$')
  GROUP BY b.category
  ORDER BY b.category;
$$;

-- Only the server's service-role client may invoke the aggregate. The function
-- itself has no privilege escalation; service_role already has BYPASSRLS.
REVOKE ALL ON FUNCTION public.get_business_category_counts(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_category_counts(boolean) TO service_role;

COMMIT;
