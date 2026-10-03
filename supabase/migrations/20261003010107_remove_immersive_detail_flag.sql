-- The desktop post viewer is now the standard desktop post page for everyone.
-- Its rollout switch is no longer read by the app, so remove it.
DELETE FROM public.feature_flags WHERE key = 'immersive_detail';
