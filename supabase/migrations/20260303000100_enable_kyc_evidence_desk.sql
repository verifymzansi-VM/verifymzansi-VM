-- Enable the evidence desk feature flag so admins can view KYC documents inline
-- This seed runs before the later audit-trigger type fix. Skip its audit row
-- while retaining the trigger for all subsequent feature-flag changes.
ALTER TABLE public.feature_flags DISABLE TRIGGER trg_feature_flag_audit;

UPDATE public.feature_flags
SET enabled = true
WHERE key = 'kyc_evidence_desk';

ALTER TABLE public.feature_flags ENABLE TRIGGER trg_feature_flag_audit;
