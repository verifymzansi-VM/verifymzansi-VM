-- Desktop post viewer (Reels-style) for Market, Business and Tourism & Events.
-- Seeded OFF. Turn it on from the admin feature-flag panel: "allowlist" for
-- staff testing first, then "percent", then "on". Without this row the flag
-- service already treats the viewer as off; the row makes it controllable.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('immersive_detail', false,
   'Desktop (1024px and wider) post pages open in the full-screen viewer: media in the centre, details beside it, scroll or swipe to the next post from the same list. Phones keep the classic page.')
ON CONFLICT (key) DO NOTHING;
