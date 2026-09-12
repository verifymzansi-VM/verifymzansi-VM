-- Add this enum value in its own migration so later table and data changes can
-- use it after PostgreSQL commits the enum alteration.
ALTER TYPE public.marketplace_area ADD VALUE IF NOT EXISTS 'MZANSI_BUSINESS';
