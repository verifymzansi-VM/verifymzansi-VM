-- Ensure free posts carry enforceable expiry and post-creation terms consent.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_listings_live_expiry
  ON public.listings (expires_at)
  WHERE status = 'live' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_live_expiry
  ON public.businesses (expires_at)
  WHERE status = 'live' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promotions_live_expiry
  ON public.promotions (expires_at)
  WHERE status = 'live' AND expires_at IS NOT NULL;

DROP POLICY IF EXISTS "Public reads live listings" ON public.listings;
CREATE POLICY "Public reads live listings" ON public.listings FOR SELECT
  USING (
    (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
    OR (
      status = 'live'
      AND (expires_at IS NULL OR expires_at > now())
    )
  );

DROP POLICY IF EXISTS "Public reads live businesses" ON public.businesses;
CREATE POLICY "Public reads live businesses" ON public.businesses FOR SELECT
  USING (
    (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
    OR (
      status = 'live'
      AND (expires_at IS NULL OR expires_at > now())
    )
  );

DROP POLICY IF EXISTS "Public can view live promotions" ON public.promotions;
DROP POLICY IF EXISTS "Owners can view own promotions" ON public.promotions;
CREATE POLICY "Owners can view own promotions" ON public.promotions FOR SELECT
  USING (
    (select auth.uid()) = owner_id
    OR (select public.has_any_role(ARRAY['moderator', 'admin']))
    OR (
      status = 'live'
      AND (expires_at IS NULL OR expires_at > now())
    )
  );
