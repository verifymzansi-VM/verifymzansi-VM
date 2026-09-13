-- Enforce repeat-view suppression in the database, including concurrent tabs.
CREATE OR REPLACE FUNCTION public.record_content_playback(
  p_target_id UUID,
  p_target_type TEXT,
  p_viewer_key TEXT,
  p_playback_id UUID,
  p_viewer_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_target_type NOT IN ('listing', 'business', 'promotion')
     OR p_viewer_key IS NULL OR btrim(p_viewer_key) = '' OR p_playback_id IS NULL THEN
    RAISE EXCEPTION 'Invalid playback view';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_target_type || ':' || p_target_id::TEXT || ':' || p_viewer_key, 0
  ));

  IF EXISTS (
    SELECT 1 FROM public.listing_views
    WHERE target_id = p_target_id AND target_type = p_target_type
      AND created_at > now() - interval '30 minutes'
      AND split_part(viewer_key, '#playback:', 1) = p_viewer_key
      AND position('#playback:' in viewer_key) > 0
  ) THEN
    RETURN FALSE;
  END IF;

  RETURN public.record_content_view(
    p_target_id, p_target_type,
    p_viewer_key || '#playback:' || p_playback_id::TEXT,
    p_viewer_user_id, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_content_playback(UUID, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_playback(UUID, TEXT, TEXT, UUID, UUID)
  TO service_role;
