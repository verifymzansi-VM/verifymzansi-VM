-- Backfill missing post expiry dates and make public visibility independent
-- from the scheduled cleanup worker.

UPDATE public.listings AS l
SET expires_at = l.created_at + INTERVAL '7 days'
FROM public.free_posts_used AS fpu
WHERE l.expires_at IS NULL
  AND fpu.released_at IS NULL
  AND fpu.content_id = l.id
  AND fpu.area = l.area;

UPDATE public.businesses AS b
SET expires_at = b.created_at + INTERVAL '7 days'
FROM public.free_posts_used AS fpu
WHERE b.expires_at IS NULL
  AND fpu.released_at IS NULL
  AND fpu.content_id = b.id
  AND fpu.area = COALESCE(b.area, 'MZANSI_BUSINESS'::public.marketplace_area);

UPDATE public.promotions AS p
SET expires_at = p.created_at + INTERVAL '7 days'
FROM public.free_posts_used AS fpu
WHERE p.expires_at IS NULL
  AND fpu.released_at IS NULL
  AND fpu.content_id = p.id
  AND fpu.area = 'PROMOTIONS_EVENTS'::public.marketplace_area;

-- Legacy unknown rows predate expires_at. Treat them as free posts so old rows
-- cannot remain public beyond the launch free-post visibility window.
UPDATE public.listings
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL
  AND status::text IN ('live', 'active');

UPDATE public.businesses
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL
  AND status::text IN ('live', 'active');

UPDATE public.promotions
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL
  AND status::text IN ('live', 'active');

-- Expire rows immediately in the database as a backstop for environments where
-- the Cloudflare cron has not run yet.
UPDATE public.listings
SET status = 'expired',
    status_reason = COALESCE(status_reason, 'Post visibility period expired')
WHERE status::text IN ('live', 'active')
  AND expires_at <= now();

UPDATE public.businesses
SET status = 'expired',
    status_reason = COALESCE(status_reason, 'Post visibility period expired')
WHERE status::text IN ('live', 'active')
  AND expires_at <= now();

UPDATE public.promotions
SET status = 'expired',
    status_reason = COALESCE(status_reason, 'Post visibility period expired')
WHERE status::text IN ('live', 'active')
  AND expires_at <= now();

DROP POLICY IF EXISTS "Public reads live listings" ON public.listings;
CREATE POLICY "Public reads live listings" ON public.listings FOR SELECT
  USING (
    (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
    OR (
      status = 'live'
      AND expires_at > now()
    )
  );

DROP POLICY IF EXISTS "Public reads live businesses" ON public.businesses;
CREATE POLICY "Public reads live businesses" ON public.businesses FOR SELECT
  USING (
    (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
    OR (
      status = 'live'
      AND expires_at > now()
    )
  );

DROP POLICY IF EXISTS "Owners can view own promotions" ON public.promotions;
CREATE POLICY "Owners can view own promotions" ON public.promotions FOR SELECT
  USING (
    (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
    OR (
      status = 'live'
      AND expires_at > now()
    )
  );
