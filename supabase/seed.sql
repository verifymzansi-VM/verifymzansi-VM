-- =================================================================
-- Local development seed — runs on `supabase db reset`
--
-- This file seeds the plans table with the active runtime pricing
-- contract (MZANSI_MARKET, MZANSI_BUSINESS, PROMOTIONS_EVENTS).
-- Legacy MALL_SHOPS / BUSINESS_ADS plans are intentionally omitted;
-- they remain in the TypeScript constants for backward-compat only.
--
-- For richer development data (accounts, listings, businesses),
-- run `pnpm seed:dev` after this file has been applied.
-- =================================================================

-- Mzansi Market plans
INSERT INTO public.plans (area, tier, name, price_cents, billing_frequency, active)
VALUES
  ('MZANSI_MARKET', 'basic',   'Mzansi Market Basic',   3000,  '30_days', true),
  ('MZANSI_MARKET', 'starter', 'Mzansi Market Starter', 10000, '30_days', true),
  ('MZANSI_MARKET', 'growth',  'Mzansi Market Growth',  25000, '30_days', true),
  ('MZANSI_MARKET', 'pro',     'Mzansi Market Pro',     65000, '30_days', true)
ON CONFLICT (area, tier) DO UPDATE SET
  name              = EXCLUDED.name,
  price_cents       = EXCLUDED.price_cents,
  billing_frequency = EXCLUDED.billing_frequency,
  active            = EXCLUDED.active;

-- Mzansi Business plans
INSERT INTO public.plans (area, tier, name, price_cents, billing_frequency, active)
VALUES
  ('MZANSI_BUSINESS', 'starter', 'Mzansi Business Starter', 15000,  '30_days', true),
  ('MZANSI_BUSINESS', 'growth',  'Mzansi Business Growth',  40000,  '30_days', true),
  ('MZANSI_BUSINESS', 'pro',     'Mzansi Business Pro',     100000, '30_days', true)
ON CONFLICT (area, tier) DO UPDATE SET
  name              = EXCLUDED.name,
  price_cents       = EXCLUDED.price_cents,
  billing_frequency = EXCLUDED.billing_frequency,
  active            = EXCLUDED.active;

-- Promotions & Events plans
INSERT INTO public.plans (area, tier, name, price_cents, billing_frequency, active)
VALUES
  ('PROMOTIONS_EVENTS', 'basic',   'Promotions Basic',   3000,  '30_days', true),
  ('PROMOTIONS_EVENTS', 'starter', 'Promotions Starter', 10000, '30_days', true),
  ('PROMOTIONS_EVENTS', 'growth',  'Promotions Growth',  25000, '30_days', true),
  ('PROMOTIONS_EVENTS', 'pro',     'Promotions Pro',     65000, '30_days', true)
ON CONFLICT (area, tier) DO UPDATE SET
  name              = EXCLUDED.name,
  price_cents       = EXCLUDED.price_cents,
  billing_frequency = EXCLUDED.billing_frequency,
  active            = EXCLUDED.active;
