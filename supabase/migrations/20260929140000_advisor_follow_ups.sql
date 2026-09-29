-- Follow-ups from the Supabase advisors after the admin rebuild.
--
-- 1. account_acquisition had two identical partner indexes; keep the
--    original (idx_account_acquisition_partner).
-- 2. Index the foreign keys added by the decision execution layer, so
--    deleting or joining decisions never scans these tables.
-- 3. appeal_cases had two permissive SELECT policies for authenticated users;
--    one policy with the same rule is evaluated once per row.
-- 4. commercial_audit labelled the actor's role from auth metadata, which
--    can be stale after a demotion; it now reads staff_roles like every
--    other audit writer. (Labels only; it never granted access.)

BEGIN;

DROP INDEX IF EXISTS public.account_acquisition_partner_idx;

CREATE INDEX IF NOT EXISTS account_restrictions_lifted_by_decision_idx
  ON public.account_restrictions (lifted_by_decision_id) WHERE lifted_by_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_effects_reverted_by_decision_idx
  ON public.content_effects (reverted_by_decision_id) WHERE reverted_by_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operation_jobs_decision_idx
  ON public.operation_jobs (decision_id) WHERE decision_id IS NOT NULL;

DROP POLICY IF EXISTS "Appellant reads own appeals" ON public.appeal_cases;
DROP POLICY IF EXISTS staff_read_appeal_cases ON public.appeal_cases;
CREATE POLICY "Appellant or decision staff read appeals" ON public.appeal_cases
  FOR SELECT TO authenticated
  USING (
    appellant_id = (SELECT auth.uid())
    OR (SELECT public.has_any_role(ARRAY['governance_controller', 'admin']::text[]))
  );

CREATE OR REPLACE FUNCTION public.commercial_audit(
  p_actor uuid, p_action text, p_target_type text, p_target_id uuid,
  p_previous jsonb, p_new jsonb, p_reason text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, actor_role, action, target_type, target_id, metadata,
                                previous_value, new_value, reason)
  VALUES (
    coalesce(p_actor, '00000000-0000-0000-0000-000000000000'),
    coalesce(public.staff_role_of(p_actor),
             (SELECT 'member' FROM auth.users WHERE id = p_actor),
             'system'),
    p_action, p_target_type, coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'),
    coalesce(p_metadata, '{}'::jsonb), p_previous, p_new, p_reason);
END;
$$;

COMMIT;
