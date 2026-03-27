ALTER TABLE public.account_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.account_profiles.avatar_url IS
  'Public profile avatar URL';
