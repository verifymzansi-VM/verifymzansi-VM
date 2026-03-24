-- Migration: One-time free post tracking per area
-- Each account gets exactly 1 free post per marketplace area.
-- Once used, the free post option disappears permanently for that area.

CREATE TABLE IF NOT EXISTS public.free_posts_used (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area       marketplace_area NOT NULL,
  listing_id UUID,                       -- optional FK to the created item
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT free_posts_used_user_area_unique UNIQUE (user_id, area)
);
-- Index for fast lookups by user + area
CREATE INDEX IF NOT EXISTS idx_free_posts_used_user_area
  ON public.free_posts_used (user_id, area);
-- RLS
ALTER TABLE public.free_posts_used ENABLE ROW LEVEL SECURITY;
-- Users can read their own free-post usage
CREATE POLICY "Users can view own free_posts_used"
  ON public.free_posts_used
  FOR SELECT
  USING (auth.uid() = user_id);
-- Users can insert their own free-post usage
CREATE POLICY "Users can insert own free_posts_used"
  ON public.free_posts_used
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- No UPDATE or DELETE — once a free post is used, it's permanent;
