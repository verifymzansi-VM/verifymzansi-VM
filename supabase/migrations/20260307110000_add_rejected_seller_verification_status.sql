DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'seller_verification_status'
      AND e.enumlabel = 'rejected'
  ) THEN
    ALTER TYPE seller_verification_status ADD VALUE 'rejected' AFTER 'verified';
  END IF;
END $$;
