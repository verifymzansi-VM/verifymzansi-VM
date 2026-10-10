-- Review-only until a verified backup, staff enrolment check and operator approval.
-- Apply BEFORE the application changes. Service-only enrolment helpers remain intact.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_session_is_active(p_user uuid, p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session AND s.user_id = p_user
    AND (s.not_after IS NULL OR s.not_after > now()));
$$;
REVOKE ALL ON FUNCTION public.staff_session_is_active(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_session_is_active(uuid, uuid) TO service_role;

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
    );
$$;
REVOKE ALL ON FUNCTION public.current_staff_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO anon, authenticated, service_role;
COMMIT;
