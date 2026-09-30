-- Route MFA checks do not protect callers that use PostgREST directly.
-- Apply the same read-access policy inside every staff RLS role helper.
-- Service-only role lookups stay independent so MFA enrolment can authorize.
BEGIN;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.staff_role_of(auth.uid())
  WHERE NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
    AND (
      auth.jwt() ->> 'aal' = 'aal2'
      OR EXISTS (
        SELECT 1 FROM public.feature_flags ff
        WHERE ff.key = 'staff_mfa_enforced'
          AND CASE
            WHEN NULLIF(to_jsonb(ff) ->> 'mode', '') IS NOT NULL
              THEN to_jsonb(ff) ->> 'mode' = 'off'
            ELSE ff.enabled = false
          END
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.staff_roles sr
          WHERE sr.user_id = auth.uid() AND sr.mfa_required_after > now()
        )
        AND NOT EXISTS (
          SELECT 1 FROM auth.mfa_factors factor
          WHERE factor.user_id = auth.uid() AND factor.status = 'verified'
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_role(required_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(public.current_staff_role() = required_role, false);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(public.current_staff_role() = ANY(roles), false);
$$;

REVOKE EXECUTE ON FUNCTION public.current_staff_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_any_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO anon, authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
