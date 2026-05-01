-- Do not authorize admin reads from auth.users.raw_user_meta_data.
-- raw_user_meta_data is user-editable; public.has_role reads app_metadata.

DROP POLICY IF EXISTS "Admin reads contact changes"
  ON public.contact_change_history;

CREATE POLICY "Admin reads contact changes"
  ON public.contact_change_history
  FOR SELECT
  USING ((select public.has_role('admin')));
