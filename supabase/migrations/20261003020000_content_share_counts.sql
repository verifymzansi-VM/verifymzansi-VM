-- A public share total counts each signed-in account or anonymous browser once.
-- Raw visitor identifiers are hashed in the server route, never returned publicly.
CREATE TABLE public.content_shares (
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing','business','promotion')),
  viewer_key TEXT NOT NULL CHECK (length(viewer_key) BETWEEN 1 AND 200),
  viewer_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id, viewer_key)
);
CREATE INDEX content_shares_user ON public.content_shares(viewer_user_id) WHERE viewer_user_id IS NOT NULL;
ALTER TABLE public.content_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.content_shares TO service_role;

CREATE FUNCTION public.record_content_share(p_target_id UUID, p_target_type TEXT, p_viewer_key TEXT, p_viewer_user_id UUID DEFAULT NULL, p_anonymous_viewer_key TEXT DEFAULT NULL)
RETURNS TABLE (counted BOOLEAN, share_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_live BOOLEAN; n INTEGER; merged INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('listing','business','promotion')
    OR p_viewer_key IS NULL OR length(p_viewer_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid share';
  END IF;
  IF p_target_type = 'listing' THEN
    SELECT status::TEXT = 'live' AND (expires_at > now() OR (expires_at IS NULL AND created_at > now() - interval '7 days')) INTO v_live FROM public.listings WHERE id=p_target_id;
  ELSIF p_target_type = 'business' THEN
    SELECT status::TEXT = 'live' AND (expires_at > now() OR (expires_at IS NULL AND created_at > now() - interval '7 days')) INTO v_live FROM public.businesses WHERE id=p_target_id;
  ELSE
    SELECT status::TEXT = 'live' AND (expires_at > now() OR (expires_at IS NULL AND created_at > now() - interval '7 days')) INTO v_live FROM public.promotions WHERE id=p_target_id;
  END IF;
  IF NOT COALESCE(v_live,FALSE) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('share:'||p_target_type||':'||p_target_id::TEXT,0));
  -- A known browser identity becomes this signed-in account, not a second person.
  IF p_viewer_user_id IS NOT NULL AND p_anonymous_viewer_key IS NOT NULL
    AND p_anonymous_viewer_key <> p_viewer_key THEN
    DELETE FROM public.content_shares s WHERE s.target_type=p_target_type
      AND s.target_id=p_target_id AND s.viewer_key=p_anonymous_viewer_key AND s.viewer_user_id IS NULL;
    GET DIAGNOSTICS merged = ROW_COUNT;
  END IF;
  INSERT INTO public.content_shares(target_type,target_id,viewer_key,viewer_user_id)
    VALUES(p_target_type,p_target_id,p_viewer_key,p_viewer_user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n > 0 AND merged = 0, COUNT(*) FROM public.content_shares s
    WHERE s.target_type=p_target_type AND s.target_id=p_target_id;
END;
$$;

CREATE FUNCTION public.get_content_share_counts(p_target_ids UUID[], p_target_type TEXT)
RETURNS TABLE(target_id UUID, share_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT requested.id, COUNT(s.viewer_key) FROM unnest(p_target_ids) requested(id)
  LEFT JOIN public.content_shares s ON s.target_id=requested.id AND s.target_type=p_target_type
  GROUP BY requested.id;
$$;
REVOKE ALL ON FUNCTION public.record_content_share(UUID,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_content_share_counts(UUID[],TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_share(UUID,TEXT,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_content_share_counts(UUID[],TEXT) TO service_role;


-- Keep contact-intent actions distinguishable in owner reports.
ALTER TABLE public.analytics_events DROP CONSTRAINT analytics_events_event_type_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_type_check CHECK (
 event_type IN ('impression','detail_view','whatsapp_click','phone_click','website_click','share','save','search_appearance','homepage_appearance','showroom_appearance','organisation_directory_appearance','sponsor_click','directions_click','booking_click','ticket_click')
);
