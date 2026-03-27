-- Allow moderators/admins to review all promotions, including non-live drafts.
CREATE POLICY "Staff reads all promotions"
  ON public.promotions
  FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));
