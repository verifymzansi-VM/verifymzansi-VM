-- ============================================================
-- Explicit backend-write policies for billing-owned tables
-- ============================================================

-- Payments are created and updated by backend checkout and webhook flows.
DROP POLICY IF EXISTS "Service role inserts payments" ON public.payments;
CREATE POLICY "Service role inserts payments"
  ON public.payments
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Service role updates payments" ON public.payments;
CREATE POLICY "Service role updates payments"
  ON public.payments
  FOR UPDATE
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- Entitlements are provisioned and refreshed by backend fulfillment paths.
DROP POLICY IF EXISTS "Service role inserts entitlements" ON public.entitlements;
CREATE POLICY "Service role inserts entitlements"
  ON public.entitlements
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Service role updates entitlements" ON public.entitlements;
CREATE POLICY "Service role updates entitlements"
  ON public.entitlements
  FOR UPDATE
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- Invoices are backend-managed artifacts even when user-readable.
DROP POLICY IF EXISTS "Service role inserts invoices" ON public.invoices;
CREATE POLICY "Service role inserts invoices"
  ON public.invoices
  FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Service role updates invoices" ON public.invoices;
CREATE POLICY "Service role updates invoices"
  ON public.invoices
  FOR UPDATE
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');