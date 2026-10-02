-- A runner whose lease expired must not acknowledge a newer runner's claim.
-- Keep the previous signature for migration history, but fail old callers closed.
REVOKE ALL ON FUNCTION public.complete_operation_job(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_operation_job(
  p_job uuid, p_ok boolean, p_error text, p_attempt integer, p_locked_until timestamptz
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  j public.operation_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.operation_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'running' OR j.attempts IS DISTINCT FROM p_attempt
    OR j.locked_until IS DISTINCT FROM p_locked_until OR j.locked_until <= now()
    OR j.locked_until IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_ok THEN
    UPDATE public.operation_jobs SET status = 'succeeded', completed_at = now(), locked_until = NULL,
      last_error = NULL, updated_at = now() WHERE id = j.id;
    RETURN 'succeeded';
  END IF;
  IF j.attempts >= j.max_attempts THEN
    UPDATE public.operation_jobs SET status = 'dead', locked_until = NULL,
      last_error = left(p_error, 500), updated_at = now() WHERE id = j.id;
    PERFORM public.record_ops_event('operation_job_dead', 'critical',
      jsonb_build_object('job_id', j.id, 'kind', j.kind, 'decision_id', j.decision_id,
        'error', left(p_error, 500)));
    RETURN 'dead';
  END IF;
  UPDATE public.operation_jobs SET status = 'pending', locked_until = NULL,
    last_error = left(p_error, 500),
    next_run_at = now() + make_interval(mins => (2 ^ least(j.attempts, 8))::integer),
    updated_at = now() WHERE id = j.id;
  RETURN 'retrying';
END;
$$;
REVOKE ALL ON FUNCTION public.complete_operation_job(uuid, boolean, text, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_operation_job(uuid, boolean, text, integer, timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
