-- Add non-negative CHECK constraints to price_cents columns that lack them.
-- The promotions table already has this constraint.

ALTER TABLE listings
  ADD CONSTRAINT listings_price_non_negative CHECK (price_cents >= 0);

ALTER TABLE businesses
  ADD CONSTRAINT businesses_price_non_negative CHECK (price_cents IS NULL OR price_cents >= 0);

ALTER TABLE plans
  ADD CONSTRAINT plans_price_non_negative CHECK (price_cents >= 0);
