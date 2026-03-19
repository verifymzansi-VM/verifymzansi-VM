-- Align KYC evidence access-log visibility with moderator review flows

DROP POLICY IF EXISTS "Admin reads evidence logs" ON public.kyc_evidence_access_logs;
DROP POLICY IF EXISTS "Staff reads evidence logs" ON public.kyc_evidence_access_logs;

CREATE POLICY "Staff reads evidence logs"
  ON public.kyc_evidence_access_logs
  FOR SELECT
  USING ((select public.has_any_role(ARRAY['moderator', 'admin'])));-- Align KYC evidence access-log visibility with moderator review flows

DROP POLICY IF EXISTS "Admin reads evidence logs" ON public.kyc_evidence_access_logs;
DROP POLICY IF EXISTS "Staff reads evidence logs" ON public.kyc_evidence_access_logs;

CREATE POLICY "Staff reads evidence logs"
  ON public.kyc_evidence_access_logs
  FOR SELECT
  USING ((select public.has_any_role(ARRAY['moderator', 'admin'])));;
