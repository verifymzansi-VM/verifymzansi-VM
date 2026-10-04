-- Mobile Video mode (/video-mode): full-screen posts with vertical icon rails
-- for phones and tablets. Starts on the staff allowlist only; widen it from
-- the admin feature-flag panel ("percent", then "on") once it is approved.
-- Without this row the flag service treats Video mode as off.
INSERT INTO public.feature_flags (key, enabled, mode, allowlist_roles, description) VALUES
  ('video_mode', true, 'allowlist', ARRAY['admin', 'moderator', 'governance_controller'],
   'Phones and tablets get a Video mode entry beside the marketplace tabs: one full-screen post at a time, swipe up for the next, category icons on the left and actions on the right.')
ON CONFLICT (key) DO NOTHING;
