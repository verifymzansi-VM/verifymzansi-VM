-- Staff database access follows the app's two-step policy for every staff role:
-- an AAL2 session on an account with a verified authenticator app (TOTP), whose
-- last authenticator code was verified within 12 hours. A session raised by any
-- other factor type grants no staff access. Service-only role lookups are
-- unchanged so enrolment and re-verification keep working.
-- Review-only until the owner approves; apply before deploying the app change.
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

COMMIT;
NOTIFY pgrst, 'reload schema';
