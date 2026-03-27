-- Allow moderators/admins to review all promotions, including non-live drafts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'promotions'
      AND policyname = 'Staff reads all promotions'
  ) THEN
    CREATE POLICY "Staff reads all promotions"
      ON public.promotions
      FOR SELECT
      USING (public.has_any_role(ARRAY['moderator', 'admin']));
  END IF;
END
$$;
