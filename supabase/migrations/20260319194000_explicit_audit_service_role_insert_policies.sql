-- ============================================================
-- Explicit backend-write policies for audit and intake tables
-- ============================================================

-- Audit log entries are appended by backend and admin-backed flows.
DROP POLICY IF EXISTS "Service role inserts audit logs" ON public.audit_logs;
CREATE POLICY "Service role inserts audit logs"
  ON public.audit_logs
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

-- Contact events are canonical service-owned intake records.
DROP POLICY IF EXISTS "Service role inserts contact events" ON public.contact_events;
CREATE POLICY "Service role inserts contact events"
  ON public.contact_events
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

-- OTP delivery and verification logs are written only by backend OTP flows.
DROP POLICY IF EXISTS "Service role inserts otp logs" ON public.otp_logs;
CREATE POLICY "Service role inserts otp logs"
  ON public.otp_logs
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

-- KYC evidence access logs are appended by staff-only evidence review flows.
DROP POLICY IF EXISTS "Service role inserts evidence logs" ON public.kyc_evidence_access_logs;
CREATE POLICY "Service role inserts evidence logs"
  ON public.kyc_evidence_access_logs
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');