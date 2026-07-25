-- A moderation approval needs an exclusive claim before applying the edit.
-- Without it, two staff members can approve/reject the same request concurrently.

ALTER TYPE public.content_edit_status ADD VALUE IF NOT EXISTS 'processing';

DROP INDEX IF EXISTS public.idx_content_edit_requests_one_pending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_edit_requests_one_active
  ON public.content_edit_requests(target_type, target_id)
  WHERE status IN ('pending', 'processing');
