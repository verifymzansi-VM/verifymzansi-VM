-- Add non-negative CHECK constraints to price_cents columns that lack them.
-- The promotions table already has this constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listings'
      AND column_name = 'price_cents'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'listings_price_non_negative'
  ) THEN
    ALTER TABLE public.listings
      ADD CONSTRAINT listings_price_non_negative CHECK (price_cents >= 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'price_cents'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'businesses_price_non_negative'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_price_non_negative CHECK (price_cents IS NULL OR price_cents >= 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'plans'
      AND column_name = 'price_cents'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plans_price_non_negative'
  ) THEN
    ALTER TABLE public.plans
      ADD CONSTRAINT plans_price_non_negative CHECK (price_cents >= 0);
  END IF;
END
$$;
