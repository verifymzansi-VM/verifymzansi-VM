-- Enable the Basic package and pending-verification entitlement lifecycle.
-- Runtime code already exposes Mzansi Market Basic and uses
-- pending_verification for restricted accounts after successful payment.

ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'basic' BEFORE 'starter';
ALTER TYPE public.entitlement_status ADD VALUE IF NOT EXISTS 'pending_verification' AFTER 'active';
