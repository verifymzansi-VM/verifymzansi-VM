-- Public SECURITY DEFINER helpers must enforce visibility themselves; their
-- owner bypasses RLS. Private organisations and unpublished businesses must
-- not disclose affiliation or sponsorship data through the public RPCs.
BEGIN;

DROP POLICY IF EXISTS "Public reads active affiliations of listed organisations" ON public.organisation_affiliations;
CREATE POLICY "Public reads active affiliations of listed organisations" ON public.organisation_affiliations
FOR SELECT USING (
  (status = 'active'
   AND EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = organisation_id AND public.organisation_is_listed(o))
   AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.status = 'live'
               AND (b.expires_at IS NULL OR b.expires_at > now())))
  OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
  OR public.is_current_organisation_admin(organisation_id)
  OR (SELECT public.has_any_role(ARRAY['admin','governance_controller']))
);

CREATE OR REPLACE FUNCTION public.organisation_public_stats(p_org uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT jsonb_build_object(
  'affiliatedCount', (SELECT count(*) FROM public.organisation_affiliations f
    JOIN public.businesses b ON b.id = f.business_id
    JOIN public.organisations o ON o.id = f.organisation_id
    WHERE f.organisation_id = p_org AND public.organisation_is_listed(o)
      AND f.status = 'active' AND b.status = 'live'
      AND (b.expires_at IS NULL OR b.expires_at > now())),
  'sponsoredCount', (SELECT count(*) FROM public.organisation_sponsorships s
    JOIN public.organisations o ON o.id = s.organisation_id
    JOIN public.organisation_affiliations f ON f.id = s.affiliation_id
    JOIN public.businesses b ON b.id = s.business_id
    WHERE s.organisation_id = p_org AND public.organisation_is_listed(o)
      AND s.status = 'active' AND s.starts_at <= now() AND s.ends_at > now()
      AND f.status = 'active' AND b.status = 'live'
      AND (b.expires_at IS NULL OR b.expires_at > now())));
$$;

CREATE OR REPLACE FUNCTION public.public_business_affiliations(p_business_ids uuid[])
RETURNS TABLE(business_id uuid, organisation_id uuid, organisation_slug text, organisation_name text, logo_url text,
 label text, programme_name text, confirmed_at timestamptz, sponsored boolean, sponsorship_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT f.business_id, o.id, o.slug, o.name, CASE WHEN o.logo_permission_at IS NOT NULL THEN o.logo_url END,
  public.affiliation_label(f.affiliation_type, o.affiliation_wording), pr.name, f.confirmed_at,
  s.id IS NOT NULL, CASE WHEN s.id IS NOT NULL THEN o.sponsorship_wording || ' ' || o.name END
 FROM public.organisation_affiliations f
 JOIN public.organisations o ON o.id = f.organisation_id
 JOIN public.businesses b ON b.id = f.business_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
 LEFT JOIN public.organisation_sponsorships s ON s.affiliation_id = f.id AND s.status = 'active'
  AND s.sponsor_type = 'ORGANISATION' AND s.starts_at <= now() AND s.ends_at > now()
 WHERE f.business_id = ANY(p_business_ids[1:200]) AND f.status = 'active' AND public.organisation_is_listed(o)
  AND b.status = 'live' AND (b.expires_at IS NULL OR b.expires_at > now())
 ORDER BY f.business_id, (s.id IS NOT NULL) DESC, f.confirmed_at;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
