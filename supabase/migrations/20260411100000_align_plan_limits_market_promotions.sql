-- Align plan feature limits with runtime pricing constants (2026-04-11).
-- MzansiMarket: maxListings now follows 1→3→9→27 pattern.
-- Promotions/Events: maxPromotions now matches MzansiBusiness counts 1→3→9.

-- ── Mzansi Market ───────────────────────────────────────────

-- Starter: maxListings 5 → 3
UPDATE public.plans
SET features = jsonb_set(features::jsonb, '{maxListings}', '3')::json,
    updated_at = now()
WHERE area = 'MZANSI_MARKET' AND tier = 'starter' AND active = true;

-- Growth: maxListings 15 → 9
UPDATE public.plans
SET features = jsonb_set(features::jsonb, '{maxListings}', '9')::json,
    updated_at = now()
WHERE area = 'MZANSI_MARKET' AND tier = 'growth' AND active = true;

-- Pro: maxListings 45 → 27
UPDATE public.plans
SET features = jsonb_set(features::jsonb, '{maxListings}', '27')::json,
    updated_at = now()
WHERE area = 'MZANSI_MARKET' AND tier = 'pro' AND active = true;

-- ── Tourism & Events (PROMOTIONS_EVENTS) ────────────────────

-- Starter: maxPromotions 5 → 1
UPDATE public.plans
SET features = jsonb_set(features::jsonb, '{maxPromotions}', '1')::json,
    updated_at = now()
WHERE area = 'PROMOTIONS_EVENTS' AND tier = 'starter' AND active = true;

-- Growth: maxPromotions 15 → 3
UPDATE public.plans
SET features = jsonb_set(features::jsonb, '{maxPromotions}', '3')::json,
    updated_at = now()
WHERE area = 'PROMOTIONS_EVENTS' AND tier = 'growth' AND active = true;

-- Pro: maxPromotions 45 → 9
UPDATE public.plans
SET features = jsonb_set(features::jsonb, '{maxPromotions}', '9')::json,
    updated_at = now()
WHERE area = 'PROMOTIONS_EVENTS' AND tier = 'pro' AND active = true;
