-- Owners could UPDATE every column of their own notifications (title,
-- message, href, type, user_id...), so a session could rewrite a system
-- notice into a phishing link shown in the app's own UI. The app only marks
-- notifications read through the user client (PATCH /api/notifications:
-- update({ read: true })); all inserts go through the service role
-- (src/lib/notifications.ts) and the insert policy already requires it.
-- Owners keep SELECT and DELETE (clear) on their own rows.
BEGIN;

REVOKE INSERT, UPDATE ON public.notifications FROM anon, authenticated;
DO $$
DECLARE
  all_cols text;
BEGIN
  -- Table-level REVOKE leaves column-level grants in place; clear them too.
  SELECT string_agg(quote_ident(attname), ', ') INTO all_cols
  FROM pg_attribute
  WHERE attrelid = 'public.notifications'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%1$s), UPDATE (%1$s) ON public.notifications FROM anon, authenticated', all_cols);
END $$;
GRANT UPDATE (read) ON public.notifications TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
