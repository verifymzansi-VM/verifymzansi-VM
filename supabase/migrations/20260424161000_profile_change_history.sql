CREATE TABLE IF NOT EXISTS public.profile_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN ('location')),
  old_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'admin', 'system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_change_history_user_type
  ON public.profile_change_history (user_id, change_type, created_at DESC);

ALTER TABLE public.profile_change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own profile changes" ON public.profile_change_history;
CREATE POLICY "Owner reads own profile changes"
  ON public.profile_change_history FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages profile changes" ON public.profile_change_history;
CREATE POLICY "Service role manages profile changes"
  ON public.profile_change_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
