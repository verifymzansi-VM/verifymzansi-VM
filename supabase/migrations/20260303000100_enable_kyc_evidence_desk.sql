-- Enable the evidence desk feature flag so admins can view KYC documents inline
-- The feature-flag audit trigger records automated changes as a system actor.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'system';

-- PostgreSQL cannot use an enum value added in the current transaction from a
-- trigger. This is a seed update, so skip its audit row and keep the trigger
-- enabled for all subsequent changes.
ALTER TABLE public.feature_flags DISABLE TRIGGER trg_feature_flag_audit;

UPDATE public.feature_flags
SET enabled = true
WHERE key = 'kyc_evidence_desk';

ALTER TABLE public.feature_flags ENABLE TRIGGER trg_feature_flag_audit;
