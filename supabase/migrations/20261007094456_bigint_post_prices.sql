-- Post prices above R21,474,836.47 overflowed INTEGER cents (posting audit
-- 2026-10-07): a R25m property listing failed to save with a 500. The
-- validation allows up to R99,999,999, so prices are stored as BIGINT.
ALTER TABLE public.listings ALTER COLUMN price_cents TYPE bigint;
ALTER TABLE public.promotions ALTER COLUMN price_cents TYPE bigint;
