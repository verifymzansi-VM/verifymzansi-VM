-- Mobile Video mode is now the standard phone and tablet experience for
-- everyone. Its rollout switch is no longer read by the app, so remove it.
DELETE FROM public.feature_flags WHERE key = 'video_mode';
