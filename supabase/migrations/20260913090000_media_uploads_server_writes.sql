-- Tracking rows authorize attachment and drive privileged R2 deletion. Their
-- keys, buckets, ownership and validation markers must come from server routes.
-- Deploy the upload routes using service-role INSERT before applying this.
-- See docs/media-upload-tracking-rollout.md; no existing rows are modified.
BEGIN;

DROP POLICY IF EXISTS media_uploads_insert ON public.media_uploads;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.media_uploads FROM PUBLIC, anon, authenticated;

-- Preserve owner reads and explicitly retain trusted upload/cleanup writes.
GRANT SELECT ON TABLE public.media_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_uploads TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
