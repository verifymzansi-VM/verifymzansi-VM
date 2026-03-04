-- Enable the evidence desk feature flag so admins can view KYC documents inline
UPDATE public.feature_flags
SET enabled = true
WHERE key = 'kyc_evidence_desk';
