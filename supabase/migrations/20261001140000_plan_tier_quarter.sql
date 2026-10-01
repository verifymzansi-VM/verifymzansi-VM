-- Document 03 (v3.2) sells Group 1 terms of 30, 90 and 180 fixed days.
-- The 90-day term needs its own tier. A new enum value cannot be used in the
-- transaction that adds it, so this runs before the catalogue migration.
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'quarter';
