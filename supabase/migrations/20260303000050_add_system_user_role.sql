-- Add the automated actor role before the feature-flag audit trigger is used.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'system';
