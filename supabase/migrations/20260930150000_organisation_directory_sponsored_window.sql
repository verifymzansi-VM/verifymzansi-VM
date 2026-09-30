-- organisation_directory reported "sponsored" for any status='active'
-- sponsorship, including one not yet started or already ended. Use the same
-- window as organisation_public_stats and public_business_affiliations
-- (20260930100000): starts_at <= now() AND ends_at > now().
-- Signature, return type, volatility, SECURITY DEFINER, search_path and
-- grants are unchanged (CREATE OR REPLACE keeps the existing ACL).
BEGIN;

CREATE OR REPLACE FUNCTION public.organisation_directory(p_org uuid, p_search text DEFAULT NULL, p_category text DEFAULT NULL,
 p_city text DEFAULT NULL, p_programme uuid DEFAULT NULL, p_sponsored boolean DEFAULT NULL, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0,
 p_province text DEFAULT NULL, p_type text DEFAULT NULL)
RETURNS TABLE(business_id uuid, business_name text, slug text, category text, subcategory text, city text, province text,
 logo_url text, cover_image text, programme_name text, confirmed_at timestamptz, sponsored boolean,
 affiliation_type text, affiliation_label text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH rows AS (
  SELECT b.id, b.business_name::text AS business_name, b.slug::text AS slug, b.category::text AS category, b.subcategory::text AS subcategory,
   b.location_city::text AS city, b.location_province::text AS province, b.logo_url::text AS logo_url,
   (to_jsonb(b)->>'cover_photo') AS cover_image, pr.name AS programme_name, f.confirmed_at,
   EXISTS (SELECT 1 FROM public.organisation_sponsorships s WHERE s.affiliation_id = f.id AND s.status = 'active'
           AND s.starts_at <= now() AND s.ends_at > now()) AS sponsored,
   f.affiliation_type, public.affiliation_label(f.affiliation_type, o.affiliation_wording) AS affiliation_label
  FROM public.organisation_affiliations f
  JOIN public.organisations o ON o.id = f.organisation_id
  JOIN public.businesses b ON b.id = f.business_id
  LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
  WHERE f.organisation_id = p_org AND f.status = 'active' AND public.organisation_is_listed(o)
   AND b.status = 'live' AND (b.expires_at IS NULL OR b.expires_at > now())
   AND (p_search IS NULL OR b.business_name ILIKE '%' || replace(replace(p_search,'%',''),'_','') || '%')
   AND (p_category IS NULL OR b.category::text = p_category)
   AND (p_city IS NULL OR b.location_city ILIKE replace(replace(p_city,'%',''),'_',''))
   AND (p_programme IS NULL OR f.programme_id = p_programme)
   AND (p_province IS NULL OR b.location_province ILIKE replace(replace(p_province,'%',''),'_',''))
   AND (p_type IS NULL OR f.affiliation_type = p_type)
 )
 SELECT r.*, count(*) OVER () FROM rows r
 WHERE p_sponsored IS NULL OR r.sponsored = p_sponsored
 ORDER BY r.business_name
 LIMIT least(greatest(p_limit,1),48) OFFSET greatest(p_offset,0);
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
