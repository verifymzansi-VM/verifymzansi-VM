-- A promotion may only link a business its own owner owns.
--
-- The promotion API checks ownership (userOwnsBusiness), but the RLS UPDATE
-- policy only checks promotions.owner_id, and guard_owner_content_edits only
-- freezes live rows. An owner calling PostgREST directly could point a draft,
-- pending or rejected promotion at someone else's business, and once
-- approved it would show on that business's page. Enforce it in the database
-- for member sessions; service-role routes keep their own ownership checks.

CREATE OR REPLACE FUNCTION public.guard_promotion_business_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.business_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = NEW.business_id AND b.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'A promotion can only link a business you own'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_promotion_business_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_promotion_business_owner ON public.promotions;
CREATE TRIGGER guard_promotion_business_owner
  BEFORE INSERT OR UPDATE OF business_id, owner_id ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_business_owner();
