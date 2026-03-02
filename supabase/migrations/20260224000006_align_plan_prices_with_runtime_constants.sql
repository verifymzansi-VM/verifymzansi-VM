-- Align plan prices with runtime pricing constants used in the application.
-- Keeps checkout (DB-driven) and pricing pages (code-driven) consistent.

UPDATE public.plans
SET price_cents = CASE
  WHEN area = 'MZANSI_MARKET' AND tier = 'starter' THEN 10000
  WHEN area = 'MZANSI_MARKET' AND tier = 'growth' THEN 25000
  WHEN area = 'MZANSI_MARKET' AND tier = 'pro' THEN 65000
  WHEN area = 'BUSINESS_ADS' AND tier = 'starter' THEN 15000
  WHEN area = 'BUSINESS_ADS' AND tier = 'growth' THEN 40000
  WHEN area = 'BUSINESS_ADS' AND tier = 'pro' THEN 100000
  WHEN area = 'MALL_SHOPS' AND tier = 'starter' THEN 20000
  WHEN area = 'MALL_SHOPS' AND tier = 'growth' THEN 50000
  WHEN area = 'MALL_SHOPS' AND tier = 'pro' THEN 120000
  ELSE price_cents
END
WHERE (area, tier) IN (
  ('MZANSI_MARKET', 'starter'),
  ('MZANSI_MARKET', 'growth'),
  ('MZANSI_MARKET', 'pro'),
  ('BUSINESS_ADS', 'starter'),
  ('BUSINESS_ADS', 'growth'),
  ('BUSINESS_ADS', 'pro'),
  ('MALL_SHOPS', 'starter'),
  ('MALL_SHOPS', 'growth'),
  ('MALL_SHOPS', 'pro')
);
