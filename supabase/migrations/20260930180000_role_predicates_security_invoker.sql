-- These wrappers need no privileges beyond the caller-scoped helpers they use.
-- current_staff_role remains the MFA-aware privileged boundary: callers cannot
-- read auth.mfa_factors or invoke staff_role_of(other_user) directly.
BEGIN;

ALTER FUNCTION public.has_role(text) SECURITY INVOKER;
ALTER FUNCTION public.has_any_role(text[]) SECURITY INVOKER;

-- A whole-row organisation_is_listed(o) call requires SELECT on private
-- organisation columns. Read only the public predicate columns instead,
-- keeping the same listed statuses and allowing organisations RLS to apply.
-- Its SELECT policy does not call organisation_id_is_listed, so this lookup
-- does not recurse when used by programme and affiliation SELECT policies.
CREATE OR REPLACE FUNCTION public.organisation_id_is_listed(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = p_org
      AND o.is_public
      AND o.programme_status IN ('founding_trial', 'active_paid', 'affiliation_only')
  );
$$;

-- ALTER/CREATE OR REPLACE preserve the existing restricted EXECUTE grants.
COMMIT;
NOTIFY pgrst, 'reload schema';
