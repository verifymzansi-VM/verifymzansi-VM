-- Data requests (DSAR): deadlines with a stated basis, extensions with
-- notice, assignment, manual intake, a verified subject, and a retention
-- overview.
--
-- Deadline values live in dsar_deadline_rules, not in code. They are the
-- defaults agreed with the owner and must be confirmed by the Information
-- Officer; they are not legal advice. Every case stores when it was
-- received, the rule's basis, the original due date and any extension.

BEGIN;

CREATE TABLE public.dsar_deadline_rules (
  request_type   text PRIMARY KEY,
  days           integer NOT NULL CHECK (days > 0),
  extension_days integer NOT NULL DEFAULT 0 CHECK (extension_days >= 0),
  statutory      boolean NOT NULL,
  source         text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dsar_deadline_rules (request_type, days, extension_days, statutory, source) VALUES
  ('access', 30, 30, true,
   'Access request: PAIA s25 via POPIA s23 — 30 days; one extension of up to 30 days with written notice (PAIA s26)'),
  ('correction', 30, 0, false, 'Internal target: POPIA s24 sets no fixed period'),
  ('deletion', 30, 0, false, 'Internal target: POPIA s24 sets no fixed period'),
  ('objection', 30, 0, false, 'Internal target: POPIA s11(3) sets no fixed period')
ON CONFLICT (request_type) DO NOTHING;

ALTER TABLE public.dsar_deadline_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dsar_deadline_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dsar_deadline_rules TO authenticated;
GRANT ALL ON public.dsar_deadline_rules TO service_role;
CREATE POLICY "Anyone signed in reads deadline rules" ON public.dsar_deadline_rules
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.dsar_cases
  ADD COLUMN IF NOT EXISTS subject_user_id uuid,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_basis text,
  ADD COLUMN IF NOT EXISTS extended_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS extension_reason text,
  ADD COLUMN IF NOT EXISTS extension_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS identity_check text NOT NULL DEFAULT 'session'
    CHECK (identity_check IN ('session', 'manual')),
  ADD COLUMN IF NOT EXISTS intake_by uuid;

UPDATE public.dsar_cases SET received_at = created_at WHERE received_at IS NULL;
ALTER TABLE public.dsar_cases ALTER COLUMN received_at SET NOT NULL;
ALTER TABLE public.dsar_cases ALTER COLUMN received_at SET DEFAULT now();

-- Existing cases: link the subject when exactly one account uses the email.
UPDATE public.dsar_cases d
   SET subject_user_id = u.id
  FROM auth.users u
 WHERE d.subject_user_id IS NULL
   AND lower(u.email) = lower(d.requester_email)
   AND (SELECT count(*) FROM auth.users u2 WHERE lower(u2.email) = lower(d.requester_email)) = 1;

UPDATE public.dsar_cases d
   SET legal_basis = r.source
  FROM public.dsar_deadline_rules r
 WHERE d.legal_basis IS NULL AND r.request_type = d.type::text;

-- The deadline that applies now, so screens can sort and filter on it.
ALTER TABLE public.dsar_cases
  ADD COLUMN IF NOT EXISTS effective_due_at timestamptz
    GENERATED ALWAYS AS (coalesce(extended_due_at, due_by)) STORED;

CREATE INDEX IF NOT EXISTS dsar_cases_open_due_idx
  ON public.dsar_cases (effective_due_at)
  WHERE status IN ('submitted', 'identity_pending', 'in_progress');
CREATE INDEX IF NOT EXISTS dsar_cases_assigned_idx
  ON public.dsar_cases (assigned_to)
  WHERE status IN ('submitted', 'identity_pending', 'in_progress');
CREATE INDEX IF NOT EXISTS dsar_cases_subject_idx ON public.dsar_cases (subject_user_id);

-- New cases take their due date and basis from the rules, never from the caller.
CREATE OR REPLACE FUNCTION public.set_dsar_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.dsar_deadline_rules%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dsar_deadline_rules WHERE request_type = NEW.type::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No deadline rule for request type %', NEW.type;
  END IF;
  NEW.received_at := coalesce(NEW.received_at, now());
  NEW.due_by := NEW.received_at + make_interval(days => r.days);
  NEW.legal_basis := r.source;
  NEW.extended_due_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dsar_cases_set_deadline ON public.dsar_cases;
CREATE TRIGGER dsar_cases_set_deadline
  BEFORE INSERT ON public.dsar_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_dsar_deadline();

-- Extend once, where the rules allow it, with a reason and a notice job.
CREATE OR REPLACE FUNCTION public.extend_dsar_deadline(p_actor uuid, p_case uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  c public.dsar_cases%ROWTYPE;
  r public.dsar_deadline_rules%ROWTYPE;
  v_new timestamptz;
BEGIN
  IF NOT public.is_decision_staff(v_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;
  SELECT * INTO c FROM public.dsar_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF c.status NOT IN ('submitted', 'identity_pending', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_open');
  END IF;
  IF c.extended_due_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_extended');
  END IF;
  SELECT * INTO r FROM public.dsar_deadline_rules WHERE request_type = c.type::text;
  IF r.extension_days = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'extension_not_allowed');
  END IF;
  IF c.due_by < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_overdue');
  END IF;

  v_new := c.due_by + make_interval(days => r.extension_days);
  UPDATE public.dsar_cases
     SET extended_due_at = v_new, extension_reason = btrim(p_reason), updated_at = now()
   WHERE id = c.id;

  PERFORM public.enqueue_operation_job(
    'dsar_extension:' || c.id::text, 'email_notice',
    jsonb_build_object('template', 'dsar_extension', 'case_id', c.id, 'email', c.requester_email,
                       'due', v_new, 'reason', btrim(p_reason)),
    NULL);
  PERFORM public.decision_audit(p_actor, v_role, 'dsar_extended', 'dsar_case', c.id,
    jsonb_build_object('original_due', c.due_by, 'extended_due', v_new), p_reason);
  RETURN jsonb_build_object('ok', true, 'status', 'extended', 'due', v_new);
END;
$$;

-- What the retention jobs and evidence purges are doing, for the admin panel.
CREATE OR REPLACE FUNCTION public.retention_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_runs jsonb := '[]'::jsonb;
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'job'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'job', j.jobname,
                 'schedule', j.schedule,
                 'last_run', max(d.start_time),
                 'last_status', (array_agg(d.status ORDER BY d.start_time DESC))[1],
                 'failures_7d', count(*) FILTER (WHERE d.status = 'failed' AND d.start_time > now() - interval '7 days')
               ) AS x
          FROM cron.job j
          LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
         WHERE j.jobname LIKE 'retention%' OR j.jobname LIKE 'queue_r2%'
            OR j.jobname IN ('expire-due-items', 'expire-queue-claims')
         GROUP BY j.jobname, j.schedule) s
    $q$ INTO v_runs;
  END IF;

  RETURN jsonb_build_object(
    'jobs', v_runs,
    'deletions_pending', (SELECT count(*) FROM public.r2_cleanup_queue WHERE processed_at IS NULL),
    'deletions_stuck', (SELECT count(*) FROM public.r2_cleanup_queue
                         WHERE processed_at IS NULL AND created_at < now() - interval '1 day'),
    'evidence_overdue', (SELECT count(*) FROM public.kyc_artifacts a
                          WHERE a.purge_after IS NOT NULL AND a.purge_after < now() - interval '1 day'
                            AND NOT EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
                                             WHERE q.r2_key = a.r2_key AND q.processed_at IS NOT NULL)),
    'legal_holds', (SELECT count(*) FROM public.account_profiles WHERE legal_hold = true)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_dsar_deadline() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.extend_dsar_deadline(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retention_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_dsar_deadline(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retention_overview() TO service_role;

COMMIT;
