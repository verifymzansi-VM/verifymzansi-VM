-- RBAC authority cutover to JWT app_metadata.role.
-- Also rewrites feature flag policies to use public.has_role('admin').

CREATE OR REPLACE FUNCTION public.has_role(required_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = required_role, false);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = ANY(roles), false);
$$;

-- One-time backfill: migrate legacy role claim into app metadata where missing.
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', raw_user_meta_data ->> 'role')
WHERE (raw_app_meta_data ->> 'role') IS NULL
  AND (raw_user_meta_data ->> 'role') IS NOT NULL;

DROP POLICY IF EXISTS "Admins can insert feature flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admins can update feature flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admins can delete feature flags" ON public.feature_flags;

CREATE POLICY "Admins can insert feature flags"
  ON public.feature_flags FOR INSERT
  WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update feature flags"
  ON public.feature_flags FOR UPDATE
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can delete feature flags"
  ON public.feature_flags FOR DELETE
  USING (public.has_role('admin'));
