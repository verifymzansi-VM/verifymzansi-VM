-- ══════════════════════════════════════════════════════════════
-- RLS Policies for user-submitted tables: reports, contact_events, leads
-- Phase 3 of remediation plan — ensures insert paths work correctly
-- ══════════════════════════════════════════════════════════════

-- ── Reports ─────────────────────────────────────────────────
-- Reports can be inserted by authenticated users or service role.
-- Reads are admin-only (handled by existing policies).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'reports' AND policyname = 'reports_insert_authenticated'
  ) THEN
    CREATE POLICY reports_insert_authenticated ON public.reports
      FOR INSERT
      TO authenticated
      WITH CHECK (reporter_user_id = auth.uid());
  END IF;
END $$;

-- ── Contact Events ──────────────────────────────────────────
-- Contact events are inserted via service-role (admin client) in the API route.
-- No anon/authenticated insert policy needed — service role bypasses RLS.

-- ── Leads ───────────────────────────────────────────────────
-- Leads are inserted via service-role (admin client) in the API route.
-- Sellers can read their own leads.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'leads_select_owner'
  ) THEN
    CREATE POLICY leads_select_owner ON public.leads
      FOR SELECT
      TO authenticated
      USING (seller_id = auth.uid());
  END IF;
END $$;
