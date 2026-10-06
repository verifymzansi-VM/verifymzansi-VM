-- Organisation admins must stay ID-verified and in good standing.
--
-- require_verified_organisation_admin only runs on INSERT, so an admin whose
-- verification was later revoked, or whose account was suspended or banned,
-- kept every organisation power (approve affiliations, sponsor, end
-- sponsorships). Re-check on every call instead. Grants are preserved by
-- CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.is_organisation_admin(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (
  SELECT 1
  FROM public.organisation_admins a
  JOIN public.organisations o ON o.id = a.organisation_id
  JOIN public.account_profiles p ON p.user_id = a.user_id
  WHERE a.organisation_id = p_org
    AND a.user_id = p_user
    AND o.programme_status <> 'ended'
    AND p.account_verification_status::text = 'verified'
    AND p.account_status IN ('active', 'warned')
 );
$$;
