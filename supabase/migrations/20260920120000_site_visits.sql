-- Site visit analytics for the admin Strategy Dashboard.
-- Privacy-conscious: no raw IP is stored. Viewer identity is a pseudonymous
-- key (anon:<uuid> cookie id or user:<id>) and referrers are kept to origin only.

CREATE TABLE IF NOT EXISTS public.site_visits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path        TEXT NOT NULL,
  area        TEXT NOT NULL DEFAULT 'other',
  referrer    TEXT,
  viewer_key  TEXT NOT NULL,
  user_id     UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast time-range scans and top-page aggregation.
CREATE INDEX IF NOT EXISTS site_visits_created_at_idx ON public.site_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS site_visits_path_created_idx ON public.site_visits (path, created_at DESC);

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

-- No direct table access for clients; writes go through the RPC below and
-- reads are served by the service role on admin pages.
REVOKE ALL ON TABLE public.site_visits FROM PUBLIC, anon, authenticated;

-- Record one visit per viewer per 30-minute window per path so refreshes and
-- SPA-style revisits do not inflate counts.
CREATE OR REPLACE FUNCTION public.record_site_visit(
  p_path TEXT,
  p_referrer TEXT,
  p_viewer_key TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_area TEXT;
BEGIN
  IF p_path IS NULL OR btrim(p_path) = '' OR length(p_path) > 500
     OR p_viewer_key IS NULL OR btrim(p_viewer_key) = '' OR length(p_viewer_key) > 200 THEN
    RAISE EXCEPTION 'Invalid site visit';
  END IF;

  -- Ignore internal and asset paths even if called directly.
  IF p_path LIKE '/admin%' OR p_path LIKE '/api%' OR p_path LIKE '/_next%' THEN
    RETURN FALSE;
  END IF;

  v_area := CASE
    WHEN p_path = '/' THEN 'home'
    WHEN p_path LIKE '/mzansi-market%' OR p_path LIKE '/listing%' THEN 'mzansi_market'
    WHEN p_path LIKE '/mzansi-business%' OR p_path LIKE '/business%' THEN 'mzansi_business'
    WHEN p_path LIKE '/tourism-events%' OR p_path LIKE '/promotion%' THEN 'promotions_events'
    ELSE 'other'
  END;

  PERFORM pg_advisory_xact_lock(hashtextextended('site:' || p_path || ':' || p_viewer_key, 0));

  IF EXISTS (
    SELECT 1 FROM public.site_visits
    WHERE path = p_path
      AND viewer_key = p_viewer_key
      AND created_at > now() - interval '30 minutes'
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.site_visits (path, area, referrer, viewer_key, user_id)
  VALUES (p_path, v_area, left(coalesce(p_referrer, ''), 500), p_viewer_key, p_user_id);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.record_site_visit(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_visit(TEXT, TEXT, TEXT, UUID) TO service_role;
