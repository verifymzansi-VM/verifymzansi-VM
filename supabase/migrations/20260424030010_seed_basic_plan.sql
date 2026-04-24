-- Seed Mzansi Market Basic after the enum migration has committed.

INSERT INTO public.plans (id, area, tier, name, price_cents, billing_frequency, features, active)
VALUES (
  'b0cc0d82-b2ff-4cae-a0c2-3c7209925c98',
  'MZANSI_MARKET',
  'basic',
  'Mzansi Market Basic',
  3000,
  'monthly',
  '{
    "maxListings": 1,
    "maxPhotos": 10,
    "maxPostsPerMonth": 1,
    "videoAllowed": false,
    "boostAllowed": false,
    "featuredAllowed": false,
    "urgentAllowed": false
  }'::jsonb,
  true
)
ON CONFLICT (area, tier) DO UPDATE
SET
  id = EXCLUDED.id,
  name = EXCLUDED.name,
  price_cents = EXCLUDED.price_cents,
  billing_frequency = EXCLUDED.billing_frequency,
  features = EXCLUDED.features,
  active = true;
