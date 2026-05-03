-- Keep database enum values aligned with categories/contact methods exposed by the app.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'listing_category'
      AND e.enumlabel = 'farming_agriculture'
  ) THEN
    ALTER TYPE listing_category ADD VALUE 'farming_agriculture';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'listing_category'
      AND e.enumlabel = 'baby_kids'
  ) THEN
    ALTER TYPE listing_category ADD VALUE 'baby_kids';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'contact_method'
      AND e.enumlabel = 'in_app'
  ) THEN
    ALTER TYPE contact_method ADD VALUE 'in_app';
  END IF;
END $$;
