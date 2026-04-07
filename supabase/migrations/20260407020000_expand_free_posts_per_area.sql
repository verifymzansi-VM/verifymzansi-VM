-- Migration: allow multiple free posts per marketplace area
-- Existing rows are preserved so accounts that already used 1 free post
-- will retain that usage and have 1 free post remaining after this change.

ALTER TABLE public.free_posts_used
  DROP CONSTRAINT IF EXISTS free_posts_used_user_area_unique;

ALTER TABLE public.free_posts_used
  ADD COLUMN IF NOT EXISTS slot SMALLINT;

WITH ranked_usage AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, area ORDER BY created_at, id) AS slot_number
  FROM public.free_posts_used
)
UPDATE public.free_posts_used AS usage
SET slot = ranked_usage.slot_number::SMALLINT
FROM ranked_usage
WHERE usage.id = ranked_usage.id
  AND (usage.slot IS NULL OR usage.slot <> ranked_usage.slot_number::SMALLINT);

ALTER TABLE public.free_posts_used
  ALTER COLUMN slot SET NOT NULL;

ALTER TABLE public.free_posts_used
  ALTER COLUMN slot SET DEFAULT 1;

ALTER TABLE public.free_posts_used
  DROP CONSTRAINT IF EXISTS free_posts_used_slot_check;

ALTER TABLE public.free_posts_used
  ADD CONSTRAINT free_posts_used_slot_check CHECK (slot BETWEEN 1 AND 2);

CREATE UNIQUE INDEX IF NOT EXISTS free_posts_used_user_area_slot_unique
  ON public.free_posts_used (user_id, area, slot);
