-- Correct free-trial posts that may have been backfilled with a paid-length
-- visibility window before the seven-day rule was enforced everywhere.

UPDATE public.listings AS l
SET expires_at = l.created_at + INTERVAL '7 days'
FROM public.free_posts_used AS fpu
WHERE fpu.released_at IS NULL
  AND fpu.content_id = l.id
  AND fpu.area = l.area
  AND l.status::text IN ('live', 'active', 'pending_moderation')
  AND (
    l.expires_at IS NULL
    OR l.expires_at > l.created_at + INTERVAL '7 days'
  );

UPDATE public.businesses AS b
SET expires_at = b.created_at + INTERVAL '7 days'
FROM public.free_posts_used AS fpu
WHERE fpu.released_at IS NULL
  AND fpu.content_id = b.id
  AND fpu.area = COALESCE(b.area, 'MZANSI_BUSINESS'::public.marketplace_area)
  AND b.status::text IN ('live', 'active', 'pending_moderation')
  AND (
    b.expires_at IS NULL
    OR b.expires_at > b.created_at + INTERVAL '7 days'
  );

UPDATE public.promotions AS p
SET expires_at = p.created_at + INTERVAL '7 days'
FROM public.free_posts_used AS fpu
WHERE fpu.released_at IS NULL
  AND fpu.content_id = p.id
  AND fpu.area = 'PROMOTIONS_EVENTS'::public.marketplace_area
  AND p.status::text IN ('live', 'active', 'pending_moderation')
  AND (
    p.expires_at IS NULL
    OR p.expires_at > p.created_at + INTERVAL '7 days'
  );

UPDATE public.listings
SET status = 'expired',
    status_reason = COALESCE(status_reason, 'Free post visibility period expired')
WHERE status::text IN ('live', 'active')
  AND expires_at <= now();

UPDATE public.businesses
SET status = 'expired',
    status_reason = COALESCE(status_reason, 'Free post visibility period expired')
WHERE status::text IN ('live', 'active')
  AND expires_at <= now();

UPDATE public.promotions
SET status = 'expired',
    status_reason = COALESCE(status_reason, 'Free post visibility period expired')
WHERE status::text IN ('live', 'active')
  AND expires_at <= now();
