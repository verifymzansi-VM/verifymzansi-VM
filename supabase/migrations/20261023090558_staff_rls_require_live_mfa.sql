-- Source-project staff RLS follows both the signed token and the live session.
-- A previously issued AAL2 JWT must stop granting staff access once GoTrue
-- downgrades that session. Keep service-only enrolment lookups available at
-- AAL1 so a staff member can enrol or re-verify without accessing staff data.
-- This migration is for the legacy/source schema, never the London foundation.
BEGIN;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.staff_role_of(auth.uid())
  WHERE NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
    AND auth.jwt() ->> 'aal' = 'aal2'
    AND EXISTS (
      SELECT 1 FROM auth.sessions s
      WHERE s.user_id = auth.uid() AND s.id::text = auth.jwt() ->> 'session_id'
        AND s.aal = 'aal2'
        AND (s.not_after IS NULL OR s.not_after > now())
    )
    AND EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = auth.uid() AND f.factor_type = 'totp' AND f.status = 'verified'
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(auth.jwt() -> 'amr') = 'array' THEN auth.jwt() -> 'amr' ELSE '[]'::jsonb END
      ) a
      WHERE jsonb_typeof(a) = 'object' AND a ->> 'method' = 'totp'
        AND CASE WHEN a ->> 'timestamp' ~ '^[0-9]{1,12}$'
          THEN (a ->> 'timestamp')::bigint >= extract(epoch FROM now() - interval '12 hours')
          ELSE false END
    );
$$;
REVOKE ALL ON FUNCTION public.current_staff_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO anon, authenticated, service_role;

-- Server routes use the service role, so they must check the same live MFA
-- facts before issuing privileged reads/writes that bypass application RLS.
-- Password-only sessions keep using staff_session_is_active for enrolment.
CREATE FUNCTION public.staff_session_has_live_mfa(p_user uuid, p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = p_session AND s.user_id = p_user AND s.aal = 'aal2'
      AND (s.not_after IS NULL OR s.not_after > now())
      AND EXISTS (
        SELECT 1 FROM auth.mfa_factors f
        WHERE f.user_id = s.user_id AND f.factor_type = 'totp' AND f.status = 'verified'
      )
  );
$$;
REVOKE ALL ON FUNCTION public.staff_session_has_live_mfa(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_session_has_live_mfa(uuid,uuid) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
