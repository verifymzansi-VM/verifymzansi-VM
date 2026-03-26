-- Decision ledger, appeal workflow, and role lifecycle tables
-- Phase 2 of the three-role back-office implementation

-- ── Enums ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.decision_status AS ENUM (
    'recommended',
    'pending_approval',
    'approved',
    'rejected',
    'escalated',
    'appealed',
    'overridden',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sensitive_action_category AS ENUM (
    'kyc_override',
    'account_ban',
    'account_suspend',
    'content_removal',
    'data_deletion',
    'role_change',
    'policy_exception'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.appeal_status AS ENUM (
    'submitted',
    'under_review',
    'upheld',
    'overturned',
    'partially_overturned',
    'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Decision Records ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.decision_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type       text NOT NULL,
  case_id         text NOT NULL,
  action_category public.sensitive_action_category NOT NULL,
  status          public.decision_status NOT NULL DEFAULT 'recommended',
  -- Recommendation fields
  recommender_id  uuid NOT NULL REFERENCES auth.users(id),
  recommendation  text NOT NULL,
  rationale       text NOT NULL,
  evidence_refs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_clause   text,
  -- Approval fields (populated by governance controller)
  approver_id     uuid REFERENCES auth.users(id),
  approval_rationale text,
  secondary_approver_id uuid REFERENCES auth.users(id),
  -- State tracking
  before_state    jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state     jsonb,
  -- Lineage
  correlation_id  uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_decision_id uuid REFERENCES public.decision_records(id),
  -- Retention
  retention_class text NOT NULL DEFAULT 'standard',
  legal_hold      boolean NOT NULL DEFAULT false,
  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_decision_records_case
  ON public.decision_records(case_type, case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_records_recommender
  ON public.decision_records(recommender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_records_approver
  ON public.decision_records(approver_id, created_at DESC)
  WHERE approver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decision_records_status
  ON public.decision_records(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_records_correlation
  ON public.decision_records(correlation_id);

-- ── Decision Record Events (immutable append-only) ────────

CREATE TABLE IF NOT EXISTS public.decision_record_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     uuid NOT NULL REFERENCES public.decision_records(id),
  actor_id        uuid NOT NULL REFERENCES auth.users(id),
  actor_role      text NOT NULL,
  event_type      text NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_events_decision
  ON public.decision_record_events(decision_id, created_at);

CREATE INDEX IF NOT EXISTS idx_decision_events_actor
  ON public.decision_record_events(actor_id, created_at DESC);

-- ── Appeal Cases ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appeal_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id       uuid NOT NULL REFERENCES public.decision_records(id),
  appellant_id      uuid NOT NULL REFERENCES auth.users(id),
  status            public.appeal_status NOT NULL DEFAULT 'submitted',
  reason            text NOT NULL,
  evidence_refs     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Reviewer
  reviewer_id       uuid REFERENCES auth.users(id),
  reviewer_rationale text,
  outcome_detail    jsonb,
  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_appeal_cases_decision
  ON public.appeal_cases(decision_id);

CREATE INDEX IF NOT EXISTS idx_appeal_cases_status
  ON public.appeal_cases(status, created_at DESC);

-- ── Role Assignments History ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.role_assignments_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id  uuid NOT NULL REFERENCES auth.users(id),
  previous_role   text,
  new_role        text NOT NULL,
  assigned_by     uuid NOT NULL REFERENCES auth.users(id),
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_history_target
  ON public.role_assignments_history(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_role_history_assigned_by
  ON public.role_assignments_history(assigned_by, created_at DESC);

-- ── RLS Policies ──────────────────────────────────────────
-- All tables are accessed via service_role (admin client) from API routes.
-- Staff reads via authenticated role are restricted by capability checks in code.

ALTER TABLE public.decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_record_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appeal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_assignments_history ENABLE ROW LEVEL SECURITY;

-- Service role full access (for API routes using createAdminClient)
CREATE POLICY "service_role_decision_records" ON public.decision_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_decision_events" ON public.decision_record_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_appeal_cases" ON public.appeal_cases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_role_history" ON public.role_assignments_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Staff read access (authenticated users with staff roles can read)
CREATE POLICY "staff_read_decision_records" ON public.decision_records
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt()->'app_metadata'->>'role') IN ('moderator', 'governance_controller', 'admin'))
  );

CREATE POLICY "staff_read_decision_events" ON public.decision_record_events
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt()->'app_metadata'->>'role') IN ('moderator', 'governance_controller', 'admin'))
  );

CREATE POLICY "staff_read_appeal_cases" ON public.appeal_cases
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt()->'app_metadata'->>'role') IN ('governance_controller', 'admin'))
  );

CREATE POLICY "staff_read_role_history" ON public.role_assignments_history
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt()->'app_metadata'->>'role') IN ('governance_controller', 'admin'))
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_decision_records_updated_at
  BEFORE UPDATE ON public.decision_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_appeal_cases_updated_at
  BEFORE UPDATE ON public.appeal_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
