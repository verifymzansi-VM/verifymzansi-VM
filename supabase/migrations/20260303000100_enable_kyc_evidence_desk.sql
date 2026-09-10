-- Enable the evidence desk feature flag so admins can view KYC documents inline
-- The feature-flag audit trigger records automated changes as a system actor.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'system';

UPDATE public.feature_flags
SET enabled = true
WHERE key = 'kyc_evidence_desk';
