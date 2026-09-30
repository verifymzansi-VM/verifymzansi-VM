-- Internal organisation and affiliation bookkeeping was readable by anon and
-- authenticated through the public "listed organisation" / "active
-- affiliation" policies and full table SELECT grants:
--   organisations: logo_permission_by, logo_permission_reference, contract_id,
--                  created_by, admin_limit, sponsored_capacity
--   organisation_affiliations: confirmed_by, revoked_by, revoke_reason
-- Every user-scoped read of these tables selects an explicit public column
-- list; staff and organisation-admin screens read them with the service role.
--
-- Column privileges: SELECT is revoked at table level and granted again on
-- every other column. A column added to these tables later is NOT readable
-- by anon/authenticated until it is granted explicitly.
--
-- Policies on organisation_programmes and organisation_affiliations called
-- organisation_is_listed(o) on a whole organisations row inside a subquery,
-- which needs SELECT on every organisations column once some are revoked.
-- They now call organisation_id_is_listed(uuid) (SECURITY DEFINER) instead.
-- The organisations policy itself keeps organisation_is_listed(organisations):
-- a table's own policy expressions are not column-privilege checked.
BEGIN;

CREATE OR REPLACE FUNCTION public.organisation_id_is_listed(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE((SELECT public.organisation_is_listed(o) FROM public.organisations o WHERE o.id = p_org), false);
$$;
REVOKE ALL ON FUNCTION public.organisation_id_is_listed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organisation_id_is_listed(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public reads programmes of listed organisations" ON public.organisation_programmes;
CREATE POLICY "Public reads programmes of listed organisations" ON public.organisation_programmes
FOR SELECT USING (
  public.organisation_id_is_listed(organisation_id)
  OR public.is_current_organisation_admin(organisation_id)
  OR (SELECT public.has_any_role(ARRAY['admin','governance_controller']))
);

-- Same predicate as 20260930100000; only the listed-organisation check changed.
DROP POLICY IF EXISTS "Public reads active affiliations of listed organisations" ON public.organisation_affiliations;
CREATE POLICY "Public reads active affiliations of listed organisations" ON public.organisation_affiliations
FOR SELECT USING (
  (status = 'active'
   AND public.organisation_id_is_listed(organisation_id)
   AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'live'
               AND (b.expires_at IS NULL OR b.expires_at > now())))
  OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
  OR public.is_current_organisation_admin(organisation_id)
  OR (SELECT public.has_any_role(ARRAY['admin','governance_controller']))
);

DO $$
DECLARE
  spec record;
  public_cols text;
  private_cols text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('organisations', ARRAY['logo_permission_by','logo_permission_reference','contract_id',
                              'created_by','admin_limit','sponsored_capacity']),
      ('organisation_affiliations', ARRAY['confirmed_by','revoked_by','revoke_reason'])
    ) AS t(tbl, hidden)
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE NOT a.attname = ANY(spec.hidden)),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE a.attname = ANY(spec.hidden))
      INTO public_cols, private_cols
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', spec.tbl)::regclass
      AND a.attnum > 0 AND NOT a.attisdropped;

    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', spec.tbl);
    IF private_cols IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT (%s) ON public.%I FROM anon, authenticated', private_cols, spec.tbl);
    END IF;
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', public_cols, spec.tbl);
  END LOOP;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
