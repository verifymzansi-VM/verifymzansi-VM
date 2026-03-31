-- Ensure location_method enum supports all verification flows.
-- This is idempotent and safe for partially-migrated environments.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'location_method'
      AND e.enumlabel = 'manual'
  ) THEN
    ALTER TYPE public.location_method ADD VALUE 'manual';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'location_method'
      AND e.enumlabel = 'manual_with_gps'
  ) THEN
    ALTER TYPE public.location_method ADD VALUE 'manual_with_gps';
  END IF;
END $$;
